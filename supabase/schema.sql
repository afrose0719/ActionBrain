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


-- ---------------------------------------------------------------
-- Milestone 5: Inbox — raw captured text waiting to be turned into tasks.
-- ---------------------------------------------------------------
create table if not exists public.inbox_items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type    text not null default 'note',
  source_ref     text,                       -- e.g. "Email from Rajesh"
  content        text not null,
  status         text not null default 'new' check (status in ('new', 'analyzed', 'archived')),
  ai_suggestions jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.inbox_items enable row level security;

create policy "Users read own inbox"   on public.inbox_items for select using (auth.uid() = user_id);
create policy "Users insert own inbox" on public.inbox_items for insert with check (auth.uid() = user_id);
create policy "Users update own inbox" on public.inbox_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own inbox" on public.inbox_items for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------
-- Milestone 6: Commitments — promises made by you ('mine') or to you ('theirs').
-- AI-detected ones start as 'suggested' until you confirm them.
-- ---------------------------------------------------------------
create table if not exists public.commitments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  direction     text not null default 'mine' check (direction in ('mine', 'theirs')),
  owner_name    text,            -- who made the commitment
  counterparty  text,            -- who it was made to
  description   text not null,
  due_date      timestamptz,
  status        text not null default 'open' check (status in ('suggested', 'open', 'done', 'dismissed')),
  source_type   text,
  source_id     text,
  source_text   text,
  confidence    real,
  ai_generated  boolean not null default false,
  task_id       uuid references public.tasks(id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.commitments enable row level security;

create policy "Users read own commitments"   on public.commitments for select using (auth.uid() = user_id);
create policy "Users insert own commitments" on public.commitments for insert with check (auth.uid() = user_id);
create policy "Users update own commitments" on public.commitments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own commitments" on public.commitments for delete using (auth.uid() = user_id);

create trigger commitments_set_updated_at before update on public.commitments
for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------
-- Milestone 11: Meetings — a transcript turned into a summary, decisions, commitments and tasks.
-- ---------------------------------------------------------------
create table if not exists public.meetings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null,
  meeting_date   timestamptz not null default now(),
  attendees      text,
  transcript     text not null,
  status         text not null default 'new' check (status in ('new', 'analyzed')),
  summary        text,
  decisions      jsonb not null default '[]'::jsonb,
  ai_suggestions jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.meetings enable row level security;

create policy "Users read own meetings"   on public.meetings for select using (auth.uid() = user_id);
create policy "Users insert own meetings" on public.meetings for insert with check (auth.uid() = user_id);
create policy "Users update own meetings" on public.meetings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own meetings" on public.meetings for delete using (auth.uid() = user_id);


-- ---------------------------------------------------------------
-- Milestone 13: Google Calendar connection (read-only).
-- Stores ONLY the refresh token, and only in encrypted form (encrypted by the server before saving).
-- ---------------------------------------------------------------
create table if not exists public.google_connections (
  user_id                 uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  google_email            text,
  updated_at              timestamptz not null default now()
);

alter table public.google_connections enable row level security;

create policy "Users read own google connection"   on public.google_connections for select using (auth.uid() = user_id);
create policy "Users insert own google connection" on public.google_connections for insert with check (auth.uid() = user_id);
create policy "Users update own google connection" on public.google_connections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own google connection" on public.google_connections for delete using (auth.uid() = user_id);

create trigger google_connections_set_updated_at before update on public.google_connections
for each row execute function public.set_updated_at();
