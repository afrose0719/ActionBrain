-- Run in Supabase -> SQL Editor -> New query -> Run
-- (Safe to run more than once. Already included in schema.sql for fresh projects.)

-- ---------------------------------------------------------------
-- Milestone 27: Microsoft Teams.
--  1. Phone messages can now come from a second chat app, "teams" (the Android app reads Teams notifications and open chats).
--  2. The ingest logic lives in ONE internal function, used by two doors:
--       ingest_message(token ...)  the phone, with its private token (as before, plus p_source)
--       ingest_my_message(...)     a signed-in user's own request, used by the Microsoft Graph sync
--     The internal function can be called by neither anonymous visitors nor logged-in users directly.
--  3. microsoft_connections: one row per user who connected their Microsoft work account (encrypted refresh token only).
-- No service-role key anywhere. Row Level Security on the new table.
-- ---------------------------------------------------------------

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
create or replace function public.ingest_message(p_token text, p_sender text, p_text text, p_group text default null, p_mine boolean default false, p_source text default 'whatsapp')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.intake_settings%rowtype;
begin
  if p_token is null or p_token !~ '^abi_[A-Za-z0-9_-]{43}$' then
    return 'invalid';
  end if;

  select * into s from public.intake_settings where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    return 'invalid';
  end if;

  return public._ingest_chat_message(s.user_id, p_source, p_sender, p_text, p_group, p_mine, null, s.timezone, s.ignore_groups, s.allowed_senders);
end;
$$;

revoke all on function public.ingest_message(text, text, text, text, boolean, text) from public;
grant execute on function public.ingest_message(text, text, text, text, boolean, text) to anon, authenticated;

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
