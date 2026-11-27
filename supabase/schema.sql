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
  created_at     timestamptz not null default now(),
  last_message_at timestamptz not null default now(),   -- Milestone 26: when the newest line of this item arrived
  message_count   integer not null default 1            -- Milestone 26: how many messages are in this item
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

-- Milestone 27: Microsoft Teams. The ingest logic is one internal function with two doors (the phone's token, and a signed-in user).
-- See supabase/milestone27-teams.sql for the explanation.
-- ---- 3. the connection table ----
create table if not exists public.microsoft_connections (
  user_id                 uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  ms_user_id              text,                       -- the user's id in Microsoft, to tell your messages from others
  tenant_id               text,                       -- the company's directory id
  account                 text,                       -- e.g. your work email, shown in Settings
  scopes                  text,                       -- what Microsoft actually granted
  connected_at            timestamptz not null default now(),
  last_synced_at          timestamptz,                -- newest message already imported
  updated_at              timestamptz not null default now()
);

alter table public.microsoft_connections enable row level security;

drop policy if exists "Users read own microsoft connection"   on public.microsoft_connections;
drop policy if exists "Users insert own microsoft connection" on public.microsoft_connections;
drop policy if exists "Users update own microsoft connection" on public.microsoft_connections;
drop policy if exists "Users delete own microsoft connection" on public.microsoft_connections;
create policy "Users read own microsoft connection"   on public.microsoft_connections for select using (auth.uid() = user_id);
create policy "Users insert own microsoft connection" on public.microsoft_connections for insert with check (auth.uid() = user_id);
create policy "Users update own microsoft connection" on public.microsoft_connections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own microsoft connection" on public.microsoft_connections for delete using (auth.uid() = user_id);

drop trigger if exists microsoft_connections_set_updated_at on public.microsoft_connections;
create trigger microsoft_connections_set_updated_at before update on public.microsoft_connections
for each row execute function public.set_updated_at();

-- ---- 2. the shared internal function ----
-- Returns 'stored', 'duplicate', 'ignored' or 'limit'.
-- One conversation = one Inbox item while it is active (60 minute quiet gap from the LAST message). A conversation is one person for a
-- one-to-one chat and one group for a group chat. Only items you have not analyzed yet take new lines.
create or replace function public._ingest_chat_message(
  p_user_id uuid, p_source text, p_sender text, p_text text, p_group text, p_mine boolean,
  p_sent_at timestamptz, p_timezone text, p_ignore_groups boolean, p_allowed text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := case when lower(coalesce(p_source, '')) = 'teams' then 'teams' else 'whatsapp' end;
  v_sender text := left(btrim(coalesce(p_sender, '')), 100);
  v_text   text := left(btrim(coalesce(p_text, '')), 1500);
  v_group  text := nullif(left(btrim(coalesce(p_group, '')), 100), '');
  v_when   timestamptz := coalesce(p_sent_at, now());
  v_stamp  text;
  v_body   text;
  v_line   text;
  v_ref    text;
  v_recent public.inbox_items%rowtype;
  v_last   text;
  v_continues boolean;
begin
  if p_user_id is null then return 'invalid'; end if;
  if v_text = '' then return 'ignored'; end if;
  if v_sender = '' then v_sender := 'Unknown'; end if;
  -- "ignore group chats" and "only these senders" are the WhatsApp filters from Settings. They are WhatsApp names and choices, so they do not
  -- apply to Teams, where the user has switched Teams on on purpose and display names differ.
  if v_source = 'whatsapp' then
    if v_group is not null and coalesce(p_ignore_groups, false) then return 'ignored'; end if;
    if cardinality(coalesce(p_allowed, '{}'::text[])) > 0
       and not exists (select 1 from unnest(p_allowed) a where lower(btrim(a)) = lower(v_sender)) then
      return 'ignored';
    end if;
  end if;

  -- a leaked token or a runaway sync must not be able to flood the inbox
  if (select count(*) from public.inbox_items
       where user_id = p_user_id and source_type in ('whatsapp', 'teams') and created_at > now() - interval '1 day') >= 300 then
    return 'limit';
  end if;

  begin
    v_stamp := to_char(v_when at time zone coalesce(nullif(p_timezone, ''), 'UTC'), 'YYYY-MM-DD HH24:MI');
  exception when others then
    v_stamp := to_char(v_when at time zone 'UTC', 'YYYY-MM-DD HH24:MI');
  end;

  -- one item per conversation: per person for a one-to-one chat, per GROUP for a group chat
  v_ref := case v_source
    when 'teams' then case when v_group is null then 'Teams chat with ' || v_sender else 'Teams group: ' || v_group end
    else case when v_group is null then 'WhatsApp from ' || v_sender else 'WhatsApp group: ' || v_group end
  end;
  -- p_mine: a message YOU wrote. p_sender is then the CHAT it was written in, and the line says "You".
  if coalesce(p_mine, false) then
    v_body := 'You (' || case when v_group is null then 'to ' || v_sender else 'in ' || v_group end || '): ' || v_text;
  else
    v_body := v_sender || case when v_group is null then '' else ' (in ' || v_group || ')' end || ': ' || v_text;
  end if;
  v_line := '[' || v_stamp || '] ' || v_body;

  -- the open item for this conversation: not analyzed yet, and its LAST message was less than 60 minutes ago.
  -- (an item that filled up continues in a "(continued)" item, which is found the same way)
  select * into v_recent from public.inbox_items
   where user_id = p_user_id and source_type = v_source and source_ref in (v_ref, v_ref || ' (continued)') and status = 'new'
     and last_message_at > now() - interval '60 minutes'
   order by last_message_at desc, length(source_ref) desc limit 1; -- on a tie, the "(continued)" item is the newer one
  v_continues := found;

  if v_continues then
    v_last := regexp_replace(v_recent.content, '^.*\n', '');
    if regexp_replace(v_last, '^\[[^]]*\] ', '') = v_body then
      return 'duplicate'; -- the same notification twice, or a message seen by two routes
    end if;
    if length(v_recent.content) + 1 + length(v_line) <= 6000 then
      update public.inbox_items set content = v_recent.content || E'\n' || v_line, last_message_at = now(), message_count = message_count + 1
       where id = v_recent.id;
      update public.intake_settings set received_count = received_count + 1, last_received_at = now() where user_id = p_user_id;
      return 'stored';
    end if;
  end if;

  -- a new item. If we got here with an open item found, it was full, so this one continues it.
  insert into public.inbox_items (user_id, source_type, source_ref, content, last_message_at, message_count)
  values (p_user_id, v_source, case when v_continues then v_ref || ' (continued)' else v_ref end, v_line, now(), 1);
  update public.intake_settings set received_count = received_count + 1, last_received_at = now() where user_id = p_user_id;
  return 'stored';
end;
$$;

-- nobody calls the internal function directly: only the two functions below (which run as their owner) do
revoke all on function public._ingest_chat_message(uuid, text, text, text, text, boolean, timestamptz, text, boolean, text[]) from public, anon, authenticated;

-- ---- door 1: the phone, with its private token ----
-- The old 5-argument version is dropped first: leaving both would make a call ambiguous.
drop function if exists public.ingest_message(text, text, text, text, boolean);

-- Returns 'stored', 'duplicate', 'ignored', 'limit' or 'invalid'. Never reveals anything else.
-- Milestone 28: retry-safe intake with an optional event id. See supabase/milestone28-event-ids.sql.
create table if not exists public.intake_events (
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_id    text not null,
  received_at timestamptz not null default now(),
  primary key (user_id, event_id)
);
alter table public.intake_events enable row level security;
create index if not exists intake_events_received_at on public.intake_events (user_id, received_at);

drop function if exists public.ingest_message(text, text, text, text, boolean, text);

create or replace function public.ingest_message(p_token text, p_sender text, p_text text, p_group text default null, p_mine boolean default false, p_source text default 'whatsapp', p_event_id text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.intake_settings%rowtype;
  v_event text := nullif(btrim(coalesce(p_event_id, '')), '');
  v_result text;
begin
  if p_token is null or p_token !~ '^abi_[A-Za-z0-9_-]{43}$' then
    return 'invalid';
  end if;
  if v_event is not null and v_event !~ '^[A-Za-z0-9_-]{8,64}$' then
    return 'invalid';
  end if;

  select * into s from public.intake_settings where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    return 'invalid';
  end if;

  if v_event is not null then
    -- two requests with the same id at the same moment: the second waits here until the first has finished (review round 4)
    perform pg_advisory_xact_lock(hashtextextended(s.user_id::text || ':' || v_event, 0));
    if exists (select 1 from public.intake_events where user_id = s.user_id and event_id = v_event) then
      return 'duplicate';
    end if;
  end if;

  v_result := public._ingest_chat_message(s.user_id, p_source, p_sender, p_text, p_group, p_mine, null, s.timezone, s.ignore_groups, s.allowed_senders);

  if v_event is not null and v_result in ('stored', 'duplicate') then
    insert into public.intake_events (user_id, event_id) values (s.user_id, v_event) on conflict do nothing;
    delete from public.intake_events where user_id = s.user_id and received_at < now() - interval '30 days';
  end if;
  return v_result;
end;
$$;

revoke all on function public.ingest_message(text, text, text, text, boolean, text, text) from public;
grant execute on function public.ingest_message(text, text, text, text, boolean, text, text) to anon, authenticated;


-- ---- door 2: a signed-in user's own request (the Microsoft Graph sync) ----
-- It can only ever add to the CALLER's own inbox (auth.uid()), which Row Level Security already allows. Anonymous visitors cannot call it.
create or replace function public.ingest_my_message(
  p_source text, p_sender text, p_text text, p_group text default null, p_mine boolean default false,
  p_sent_at timestamptz default null, p_timezone text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s   public.intake_settings%rowtype;
begin
  if uid is null then
    return 'invalid';
  end if;
  select * into s from public.intake_settings where user_id = uid; -- the same filters as the phone, if the user has set any
  return public._ingest_chat_message(
    uid, p_source, p_sender, p_text, p_group, p_mine, p_sent_at,
    coalesce(nullif(p_timezone, ''), s.timezone, 'UTC'),
    coalesce(s.ignore_groups, false),
    coalesce(s.allowed_senders, '{}'::text[])
  );
end;
$$;

revoke all on function public.ingest_my_message(text, text, text, text, boolean, timestamptz, text) from public, anon;
grant execute on function public.ingest_my_message(text, text, text, text, boolean, timestamptz, text) to authenticated;


-- ---------------------------------------------------------------
-- Milestone 29: zero-touch processing (review rounds 4 and 5).
-- New phone messages are analysed in the background, and (only if the user switches it on) sure items become tasks.
--
-- Security design, agreed with both reviewers:
--  * The phone's intake token stays WRITE-ONLY for the public API. The functions below live in a private schema "worker"
--    that the public REST API does not expose, and only the dedicated database login actionbrain_worker may execute them.
--    That login's password is kept only on the server (Vercel). No service-role key, no JWT secret.
--  * The functions take the phone token, find its user by hash, and touch only that user's rows.
--  * Both switches are OFF by default and are re-checked at claim time AND at save time (switching off stops new work at once).
--  * The daily AI quota (50 analyses per user per day) is reserved inside the claim, in the same transaction, before any AI call.
--  * The model's labels are never trusted: the database decides "sure" itself (confidence >= 0.90, an exact quote, no unclear date,
--    and a known owner for promises) before inserting anything.
--  * Each claim has an id and a 5-minute lease; an abandoned claim can be picked up again (at most 3 attempts per item).
-- ---------------------------------------------------------------

-- 1. the switches (all off by default)
alter table public.user_ai_settings add column if not exists auto_analyze boolean not null default false;
alter table public.user_ai_settings add column if not exists auto_create  boolean not null default false;

-- 2. claim state on inbox items
alter table public.inbox_items add column if not exists auto_state       text;
alter table public.inbox_items add column if not exists auto_claim       uuid;
alter table public.inbox_items add column if not exists auto_lease_until timestamptz;
alter table public.inbox_items add column if not exists auto_attempts    integer not null default 0;
alter table public.inbox_items drop constraint if exists inbox_items_auto_state_check;
alter table public.inbox_items add constraint inbox_items_auto_state_check check (auto_state is null or auto_state in ('processing', 'done', 'failed'));

-- 3. provenance of automatically added tasks and promises (the "Added automatically" list and Undo read these)
alter table public.tasks       add column if not exists auto_created_at timestamptz;
alter table public.tasks       add column if not exists auto_key        text;
alter table public.commitments add column if not exists auto_created_at timestamptz;
alter table public.commitments add column if not exists auto_key        text;
create unique index if not exists tasks_auto_key       on public.tasks (user_id, auto_key)       where auto_key is not null;
create unique index if not exists commitments_auto_key on public.commitments (user_id, auto_key) where auto_key is not null;

-- 4. the daily AI quota (users can read their own count; only the worker functions write it)
create table if not exists public.ai_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  used    integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_quota enable row level security;
drop policy if exists "Users read own quota" on public.ai_quota;
create policy "Users read own quota" on public.ai_quota for select using (auth.uid() = user_id);

-- 5. the private schema: not exposed by the API, no access for public/anon/authenticated
create schema if not exists worker;
revoke all on schema worker from public;
revoke all on schema worker from anon, authenticated;

-- a timestamp from text, or null (model output is never trusted to be valid)
create or replace function worker._ts(p text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p = '' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end;
$$;

-- Is the quote really in the message? Case and spacing are ignored (models re-space text); anything else must match (review round 6).
create or replace function worker._quoted(p_quote text, p_source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select length(btrim(coalesce(p_quote, ''))) >= 3
     and position(lower(regexp_replace(btrim(p_quote), '\s+', ' ', 'g')) in lower(regexp_replace(coalesce(p_source, ''), '\s+', ' ', 'g'))) > 0;
$$;

-- the user of a phone token, or null
create or replace function worker._user_of(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.intake_settings
   where p_token ~ '^abi_[A-Za-z0-9_-]{43}$' and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- Claim up to p_limit (max 5) quiet phone items for analysis. Returns {status, ...}.
-- status: invalid | off | no_key | nothing | quota | ok.   "waiting" = phone items still inside their 10-minute quiet period.
create or replace function worker.claim_auto_work(p_token text, p_limit integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := worker._user_of(p_token);
  v_ai     public.user_ai_settings%rowtype;
  v_tz     text;
  v_name   text;
  v_claim  uuid := gen_random_uuid();
  v_used   integer;
  v_room   integer;
  v_ids    uuid[];
  v_waiting integer;
  v_items  jsonb;
begin
  if v_user is null then return jsonb_build_object('status', 'invalid'); end if;
  select * into v_ai from public.user_ai_settings where user_id = v_user;
  if not found then return jsonb_build_object('status', 'no_key'); end if;
  if not v_ai.auto_analyze then return jsonb_build_object('status', 'off'); end if;

  select count(*) into v_waiting from public.inbox_items
   where user_id = v_user and status = 'new' and source_type in ('whatsapp', 'teams') and auto_state is null
     and last_message_at >= now() - interval '10 minutes';

  -- the quota row is locked for the rest of this transaction: two claims at once cannot both spend the last slot
  insert into public.ai_quota (user_id, day) values (v_user, current_date) on conflict do nothing;
  select used into v_used from public.ai_quota where user_id = v_user and day = current_date for update;
  v_room := least(greatest(coalesce(p_limit, 5), 0), 5, 50 - v_used);

  if v_room <= 0 then
    return jsonb_build_object('status', case when v_used >= 50 then 'quota' else 'nothing' end, 'waiting', v_waiting);
  end if;

  select array_agg(id) into v_ids from (
    select id from public.inbox_items
     where user_id = v_user and status = 'new' and source_type in ('whatsapp', 'teams')
       and last_message_at < now() - interval '10 minutes'
       and (auto_state is null
            or (auto_state = 'processing' and auto_lease_until < now() and auto_attempts < 3)
            or (auto_state = 'failed' and auto_attempts < 3))
     order by last_message_at
     limit v_room
     for update skip locked
  ) picked;

  if v_ids is null then return jsonb_build_object('status', 'nothing', 'waiting', v_waiting); end if;

  update public.inbox_items
     set auto_state = 'processing', auto_claim = v_claim, auto_lease_until = now() + interval '5 minutes', auto_attempts = auto_attempts + 1
   where id = any (v_ids);
  update public.ai_quota set used = used + cardinality(v_ids) where user_id = v_user and day = current_date;

  select coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)) into v_name
    from auth.users u where u.id = v_user;
  select coalesce(nullif(timezone, ''), 'UTC') into v_tz from public.intake_settings where user_id = v_user;

  select jsonb_agg(jsonb_build_object('id', i.id, 'source_type', i.source_type, 'source_ref', i.source_ref,
                                      'content', left(i.content, 6000), 'last_message_at', i.last_message_at) order by i.last_message_at)
    into v_items from public.inbox_items i where i.id = any (v_ids);

  return jsonb_build_object('status', 'ok', 'claim', v_claim, 'provider', v_ai.provider, 'model', v_ai.model,
                            'encrypted_key', v_ai.encrypted_key, 'user_name', v_name, 'timezone', v_tz,
                            'items', v_items, 'waiting', v_waiting);
end;
$$;

-- Save the validated result for ONE claimed item. Returns {status, suggestions, added_tasks, added_commitments}.
create or replace function worker.save_auto_result(p_token text, p_claim uuid, p_item uuid, p_suggestions jsonb, p_commitments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := worker._user_of(p_token);
  v_item  public.inbox_items%rowtype;
  v_auto  boolean;
  s       jsonb;
  c       jsonb;
  v_sure  boolean;
  v_title text;
  v_desc  text;
  v_quote text;
  v_conf  real;
  v_out   jsonb := '[]'::jsonb;
  v_state text;
  v_tasks integer := 0;
  v_comms integer := 0;
  v_n     integer;
  v_key   text;
begin
  if v_user is null then return jsonb_build_object('status', 'invalid'); end if;
  select * into v_item from public.inbox_items where id = p_item and user_id = v_user for update;
  if not found or v_item.auto_state is distinct from 'processing' or v_item.auto_claim is distinct from p_claim then
    return jsonb_build_object('status', 'not_claimed');
  end if;
  if v_item.auto_lease_until < now() then return jsonb_build_object('status', 'lease_expired'); end if;

  -- re-read the switches NOW: switched off after the claim = nothing is added
  select auto_analyze and auto_create into v_auto from public.user_ai_settings where user_id = v_user;
  v_auto := coalesce(v_auto, false);

  if jsonb_typeof(p_suggestions) = 'array' then
    for s in select value from jsonb_array_elements(p_suggestions) with ordinality as e(value, n) where n <= 10 loop
      v_title := left(btrim(coalesce(s ->> 'title', '')), 200);
      continue when v_title = '';
      v_quote := left(btrim(coalesce(s ->> 'quote', '')), 300);
      v_conf  := case when jsonb_typeof(s -> 'confidence') = 'number' then least(1, greatest(0, (s ->> 'confidence')::real)) else 0.5 end;
      -- sure = high confidence AND the quote is really in the message AND the date is explicitly clear (round 6: missing = unclear)
      v_sure  := v_conf >= 0.9 and worker._quoted(v_quote, v_item.content) and (s -> 'date_unclear') = 'false'::jsonb;
      v_state := 'pending';
      if v_auto and v_sure then
        v_key := p_item::text || ':t:' || md5(lower(v_title));
        insert into public.tasks (user_id, title, description, priority, due_date, related_person, source_type, source_id, source_text,
                                  ai_generated, confidence, auto_created_at, auto_key)
        values (v_user, v_title, left(nullif(btrim(coalesce(s ->> 'description', '')), ''), 1000),
                case when s ->> 'priority' in ('low', 'medium', 'high') then s ->> 'priority' else 'medium' end,
                worker._ts(s ->> 'due_date'), left(nullif(btrim(coalesce(s ->> 'related_person', '')), ''), 120),
                v_item.source_type, p_item::text, left(coalesce(v_item.source_ref || ': ', '') || v_quote, 500),
                true, v_conf, now(), v_key)
        on conflict (user_id, auto_key) where auto_key is not null do nothing;
        get diagnostics v_n = row_count;
        v_tasks := v_tasks + v_n;
        v_state := 'created';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'state', v_state, 'title', v_title,
        'description', left(nullif(btrim(coalesce(s ->> 'description', '')), ''), 1000),
        'priority', case when s ->> 'priority' in ('low', 'medium', 'high') then s ->> 'priority' else 'medium' end,
        'due_date', worker._ts(s ->> 'due_date'), 'related_person', left(nullif(btrim(coalesce(s ->> 'related_person', '')), ''), 120),
        'confidence', v_conf, 'quote', v_quote, 'language', left(s ->> 'language', 10),
        'date_unclear', (s -> 'date_unclear') is distinct from 'false'::jsonb,
        'tier', case when v_sure then 'high' when v_conf >= 0.6 then 'review' else 'clarify' end));
    end loop;
  end if;

  if jsonb_typeof(p_commitments) = 'array' then
    for c in select value from jsonb_array_elements(p_commitments) with ordinality as e(value, n) where n <= 10 loop
      v_desc := left(btrim(coalesce(c ->> 'description', '')), 300);
      continue when v_desc = '' or coalesce(c ->> 'direction', '') not in ('mine', 'theirs');
      v_quote := left(btrim(coalesce(c ->> 'quote', '')), 300);
      v_conf  := case when jsonb_typeof(c -> 'confidence') = 'number' then least(1, greatest(0, (c ->> 'confidence')::real)) else 0.5 end;
      v_sure  := v_conf >= 0.9 and worker._quoted(v_quote, v_item.content) and (c -> 'date_unclear') = 'false'::jsonb
                 and nullif(btrim(coalesce(c ->> 'owner_name', '')), '') is not null;
      v_key := p_item::text || ':c:' || md5(lower(v_desc));
      insert into public.commitments (user_id, direction, owner_name, counterparty, description, due_date, status, source_type, source_id,
                                      source_text, confidence, ai_generated, auto_created_at, auto_key)
      values (v_user, c ->> 'direction', left(nullif(btrim(coalesce(c ->> 'owner_name', '')), ''), 120),
              left(nullif(btrim(coalesce(c ->> 'counterparty', '')), ''), 120), v_desc, worker._ts(c ->> 'due_date'),
              case when v_auto and v_sure then 'open' else 'suggested' end, v_item.source_type, p_item::text,
              left(coalesce(v_item.source_ref || ': ', '') || v_quote, 500), v_conf, true,
              case when v_auto and v_sure then now() end, v_key)
      on conflict (user_id, auto_key) where auto_key is not null do nothing;
      get diagnostics v_n = row_count;
      if v_auto and v_sure then v_comms := v_comms + v_n; end if;
    end loop;
  end if;

  update public.inbox_items
     set ai_suggestions = v_out, status = 'analyzed', auto_state = 'done', auto_lease_until = null
   where id = p_item;

  return jsonb_build_object('status', 'saved', 'suggestions', jsonb_array_length(v_out), 'added_tasks', v_tasks, 'added_commitments', v_comms);
end;
$$;

-- The AI call failed for one claimed item: release it for a later retry (the quota already spent stays spent).
create or replace function worker.fail_auto_work(p_token text, p_claim uuid, p_item uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := worker._user_of(p_token);
begin
  if v_user is null then return 'invalid'; end if;
  update public.inbox_items set auto_state = 'failed', auto_lease_until = null
   where id = p_item and user_id = v_user and auto_state = 'processing' and auto_claim = p_claim;
  return case when found then 'released' else 'not_claimed' end;
end;
$$;

revoke all on all functions in schema worker from public, anon, authenticated;

-- ---------------------------------------------------------------
-- ONE-TIME, by you (the project owner): create the worker login and give it ONLY these functions.
-- Replace CHOOSE-A-LONG-RANDOM-PASSWORD (for example: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))").
-- Run these three lines separately, after the script above:
--
--   create role actionbrain_worker with login password 'CHOOSE-A-LONG-RANDOM-PASSWORD' noinherit;
--   grant usage on schema worker to actionbrain_worker;
--   grant execute on function worker.claim_auto_work(text, integer), worker.save_auto_result(text, uuid, uuid, jsonb, jsonb), worker.fail_auto_work(text, uuid, uuid) to actionbrain_worker;
--
-- Then on Vercel set WORKER_DATABASE_URL (see docs/zero-touch.md). The role has no table access of its own.
-- ---------------------------------------------------------------
