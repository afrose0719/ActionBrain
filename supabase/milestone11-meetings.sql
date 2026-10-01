-- Run in Supabase -> SQL Editor -> New query -> Run

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
