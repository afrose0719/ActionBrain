-- Run this in Supabase dashboard -> SQL Editor -> New query -> Run

create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null,
  description    text,
  status         text not null default 'todo' check (status in ('todo', 'done')),
  priority       text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date       timestamptz,
  source_type    text,          -- e.g. email, meeting, manual
  source_id      text,
  source_text    text,          -- the original message/quote (task provenance)
  related_person text,
  related_project text,
  ai_generated   boolean not null default false,
  confidence     real,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Row Level Security: each user can only touch their own rows.
alter table public.tasks enable row level security;

create policy "Users read own tasks"   on public.tasks for select using (auth.uid() = user_id);
create policy "Users insert own tasks" on public.tasks for insert with check (auth.uid() = user_id);
create policy "Users update own tasks" on public.tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own tasks" on public.tasks for delete using (auth.uid() = user_id);

-- Keep updated_at fresh automatically.
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------
-- Milestone 4b: each user's own AI provider key (stored ENCRYPTED).
-- The key is encrypted by the server before it is saved, so the database never holds the plain key.
-- ---------------------------------------------------------------
create table if not exists public.user_ai_settings (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  provider      text not null check (provider in ('anthropic', 'openai', 'gemini')),
  model         text,
  encrypted_key text not null,
  key_hint      text,          -- last 4 characters, for display only
  updated_at    timestamptz not null default now()
);

alter table public.user_ai_settings enable row level security;

create policy "Users read own ai settings"   on public.user_ai_settings for select using (auth.uid() = user_id);
create policy "Users insert own ai settings" on public.user_ai_settings for insert with check (auth.uid() = user_id);
create policy "Users update own ai settings" on public.user_ai_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own ai settings" on public.user_ai_settings for delete using (auth.uid() = user_id);

create trigger user_ai_settings_set_updated_at before update on public.user_ai_settings
for each row execute function public.set_updated_at();
