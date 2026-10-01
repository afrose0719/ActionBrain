-- Run in Supabase -> SQL Editor -> New query -> Run

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
