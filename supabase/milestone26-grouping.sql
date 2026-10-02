-- Run in Supabase -> SQL Editor -> New query -> Run
-- (Safe to run more than once. Already included in schema.sql for fresh projects.)

-- ---------------------------------------------------------------
-- Milestone 26: keep one conversation together.
--  * inbox_items gets last_message_at (when the newest line arrived) and message_count, so the Inbox can show
--    "12 messages, 10:15 to 11:42" and keep active conversations on top.
--  * ingest_message now joins a message into the open item while the chat is ACTIVE (60 minute quiet gap, measured from the
--    last message, not the first), one item per person (one-to-one) or per group, instead of a fixed 5 minutes.
-- No new permissions, no service-role key, and Row Level Security is unchanged.
-- ---------------------------------------------------------------
alter table public.inbox_items add column if not exists last_message_at timestamptz;
alter table public.inbox_items add column if not exists message_count integer not null default 1;

-- existing rows: their newest message is when they were created
update public.inbox_items set last_message_at = created_at where last_message_at is null;
alter table public.inbox_items alter column last_message_at set default now();
alter table public.inbox_items alter column last_message_at set not null;

-- Returns one of: 'stored', 'duplicate', 'ignored', 'limit', 'invalid'. Never reveals anything else.
-- Grouping (Milestone 26): messages of one CONVERSATION go into one Inbox item for as long as the chat is active (a 60 minute quiet gap
-- ends it). A conversation is one person for a one-to-one chat and one group for a group chat. Only items you have not analyzed yet
-- take new lines, so tasks you already created or dismissed are never disturbed.
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
  v_continues boolean;
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

  -- one item per conversation: per person for a one-to-one chat, per GROUP for a group chat (every member's lines and yours, in time order)
  v_ref := case when v_group is null then 'WhatsApp from ' || v_sender else 'WhatsApp group: ' || v_group end;
  -- p_mine: a message YOU wrote (read from the open chat). p_sender is then the CHAT it was written in, and the line says "You".
  if coalesce(p_mine, false) then
    v_body := 'You (' || case when v_group is null then 'to ' || v_sender else 'in ' || v_group end || '): ' || v_text;
  else
    v_body := v_sender || case when v_group is null then '' else ' (in ' || v_group || ')' end || ': ' || v_text;
  end if;
  v_line := '[' || v_stamp || '] ' || v_body;

  -- the open item for this conversation: not analyzed yet, and its LAST message was less than 60 minutes ago.
  -- (an item that filled up continues in a "(continued)" item, which is found the same way)
  select * into v_recent from public.inbox_items
   where user_id = s.user_id and source_type = 'whatsapp' and source_ref in (v_ref, v_ref || ' (continued)') and status = 'new'
     and last_message_at > now() - interval '60 minutes'
   order by last_message_at desc, length(source_ref) desc limit 1; -- on a tie, the "(continued)" item is the newer one
  v_continues := found;

  if v_continues then
    v_last := regexp_replace(v_recent.content, '^.*\n', '');
    if regexp_replace(v_last, '^\[[^]]*\] ', '') = v_body then
      return 'duplicate'; -- Android often posts the same notification twice
    end if;
    if length(v_recent.content) + 1 + length(v_line) <= 6000 then
      update public.inbox_items set content = v_recent.content || E'\n' || v_line, last_message_at = now(), message_count = message_count + 1
       where id = v_recent.id;
      update public.intake_settings set received_count = received_count + 1, last_received_at = now() where user_id = s.user_id;
      return 'stored';
    end if;
  end if;

  -- a new item. If we got here with an open item found, it was full, so this one continues it.
  insert into public.inbox_items (user_id, source_type, source_ref, content, last_message_at, message_count)
  values (s.user_id, 'whatsapp', case when v_continues then v_ref || ' (continued)' else v_ref end, v_line, now(), 1);
  update public.intake_settings set received_count = received_count + 1, last_received_at = now() where user_id = s.user_id;
  return 'stored';
end;
$$;

revoke all on function public.ingest_message(text, text, text, text, boolean) from public;
grant execute on function public.ingest_message(text, text, text, text, boolean) to anon, authenticated;
