-- Run in Supabase -> SQL Editor -> New query -> Run
-- (Safe to run more than once. Already included in schema.sql for fresh projects.)

-- ---------------------------------------------------------------
-- Milestone 28: retry-safe phone intake (review round 2).
-- A phone may send the same message twice: a retry after a timeout, or (later) an offline queue that replays.
-- The phone can now send an event id with each message (header x-actionbrain-event-id). The first time an id is stored, the second
-- time the answer is 'duplicate' and nothing is added. Without an id, everything works as before (the content check still applies).
--  * intake_events holds only (user, event id, time): no message text. Rows older than 30 days are removed as new ones arrive.
--  * Row Level Security is on with NO policies: nobody can read or write it directly; only ingest_message (security definer) uses it.
--  * An event is remembered only when the message was stored (or was already there), so a message refused by the daily limit can be retried.
--  * Same id sent twice at the same moment: a transaction lock on (user, id) makes the second wait and then answer 'duplicate'.
-- ---------------------------------------------------------------
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
