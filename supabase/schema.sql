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


-- ---------------------------------------------------------------
-- Milestone 17: let a logged-in user delete their OWN account and all their data.
--
-- Every table references auth.users with "on delete cascade", so removing the user also removes their
-- tasks, commitments, inbox items, meetings, saved AI key and Google connection.
--
-- Security notes:
--  * SECURITY DEFINER lets this one function delete from auth.users, which a normal user cannot.
--  * It can only ever delete auth.uid(), the caller's own id, and does nothing if nobody is logged in.
--  * set search_path = '' stops anyone from tricking it into calling a look-alike function.
--  * EXECUTE is granted to logged-in users only, never to anonymous visitors.
-- ---------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not logged in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------------
-- Milestone 22: phone message intake.
-- A notification on your phone (WhatsApp...) is sent by an automation app to ActionBrain with a private token, and lands in the Inbox.
--
-- Security design:
--  * The token is 256 random bits. Only its SHA-256 hash is stored here, so the database never holds a working token.
--  * The phone is not logged in, so it cannot use Row Level Security directly. It calls ONE function, ingest_message, which
--    finds the user by token hash and can only ever INSERT/APPEND inbox rows for that user. It reads nothing back.
--  * No service-role key is needed anywhere.
--  * set search_path = '' stops look-alike function tricks; every name below is fully qualified.
-- ---------------------------------------------------------------
create table if not exists public.intake_settings (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  token_hash       text not null unique,
  token_hint       text,                                   -- last 4 characters, so you can tell which token is active
  ignore_groups    boolean not null default true,
  allowed_senders  text[] not null default '{}',           -- empty = every direct chat is accepted
  timezone         text not null default 'UTC',            -- stamps each message with YOUR local time, so "tomorrow" is read correctly
  received_count   integer not null default 0,
  last_received_at timestamptz,
  created_at       timestamptz not null default now()
);

alter table public.intake_settings enable row level security;

drop policy if exists "Users read own intake"   on public.intake_settings;
drop policy if exists "Users insert own intake" on public.intake_settings;
drop policy if exists "Users update own intake" on public.intake_settings;
drop policy if exists "Users delete own intake" on public.intake_settings;
create policy "Users read own intake"   on public.intake_settings for select using (auth.uid() = user_id);
create policy "Users insert own intake" on public.intake_settings for insert with check (auth.uid() = user_id);
create policy "Users update own intake" on public.intake_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own intake" on public.intake_settings for delete using (auth.uid() = user_id);

-- Returns one of: 'stored', 'duplicate', 'ignored', 'limit', 'invalid'. Never reveals anything else.
drop function if exists public.ingest_message(text, text, text, text);
create or replace function public.ingest_message(p_token text, p_sender text, p_text text, p_group text default null, p_mine boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.intake_settings%rowtype;
  v_sender text := left(btrim(coalesce(p_sender, '')), 100);
  v_text   text := left(btrim(coalesce(p_text, '')), 1500);
  v_group  text := nullif(left(btrim(coalesce(p_group, '')), 100), '');
  v_stamp  text;
  v_body   text;
  v_line   text;
  v_ref    text;
  v_recent public.inbox_items%rowtype;
  v_last   text;
begin
  if p_token is null or p_token !~ '^abi_[A-Za-z0-9_-]{43}$' then
    return 'invalid';
  end if;

  select * into s from public.intake_settings where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    return 'invalid';
  end if;

  if v_text = '' then return 'ignored'; end if;
  if v_sender = '' then v_sender := 'Unknown'; end if;
  if v_group is not null and s.ignore_groups then return 'ignored'; end if;
  if cardinality(s.allowed_senders) > 0
     and not exists (select 1 from unnest(s.allowed_senders) a where lower(btrim(a)) = lower(v_sender)) then
    return 'ignored';
  end if;

  -- a leaked token must not be able to flood the inbox
  if (select count(*) from public.inbox_items
       where user_id = s.user_id and source_type = 'whatsapp' and created_at > now() - interval '1 day') >= 300 then
    return 'limit';
  end if;

  begin
    v_stamp := to_char(now() at time zone s.timezone, 'YYYY-MM-DD HH24:MI');
  exception when others then
    v_stamp := to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI');
  end;

  v_ref  := 'WhatsApp from ' || v_sender || case when v_group is null then '' else ' in ' || v_group end;
  -- p_mine: a message YOU wrote (read from the open chat). p_sender is then the CHAT it was written in, and the line says "You".
  if coalesce(p_mine, false) then
    v_body := 'You (' || case when v_group is null then 'to ' || v_sender else 'in ' || v_group end || '): ' || v_text;
  else
    v_body := v_sender || case when v_group is null then '' else ' (in ' || v_group || ')' end || ': ' || v_text;
  end if;
  v_line := '[' || v_stamp || '] ' || v_body;

  -- Several messages from the same person within 5 minutes are one conversation: add to the same inbox item, so the AI sees context.
  select * into v_recent from public.inbox_items
   where user_id = s.user_id and source_type = 'whatsapp' and source_ref = v_ref and status = 'new'
     and created_at > now() - interval '5 minutes'
   order by created_at desc limit 1;

  if found then
    v_last := regexp_replace(v_recent.content, '^.*\n', '');
    if regexp_replace(v_last, '^\[[^]]*\] ', '') = v_body then
      return 'duplicate'; -- Android often posts the same notification twice
    end if;
    if length(v_recent.content) + 1 + length(v_line) <= 6000 then
      update public.inbox_items set content = v_recent.content || E'\n' || v_line where id = v_recent.id;
      update public.intake_settings set received_count = received_count + 1, last_received_at = now() where user_id = s.user_id;
      return 'stored';
    end if;
  end if;

  insert into public.inbox_items (user_id, source_type, source_ref, content) values (s.user_id, 'whatsapp', v_ref, v_line);
  update public.intake_settings set received_count = received_count + 1, last_received_at = now() where user_id = s.user_id;
  return 'stored';
end;
$$;

revoke all on function public.ingest_message(text, text, text, text, boolean) from public;
grant execute on function public.ingest_message(text, text, text, text, boolean) to anon, authenticated;
