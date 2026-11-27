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
