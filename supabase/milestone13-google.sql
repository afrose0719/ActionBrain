-- Run in Supabase -> SQL Editor -> New query -> Run

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
