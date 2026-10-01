-- Run in Supabase -> SQL Editor -> New query -> Run
-- (Safe to run more than once. Already included at the end of schema.sql for fresh projects.)

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
create or replace function public.ingest_message(p_token text, p_sender text, p_text text, p_group text default null)
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
  v_body := v_sender || case when v_group is null then '' else ' (in ' || v_group || ')' end || ': ' || v_text;
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

revoke all on function public.ingest_message(text, text, text, text) from public;
grant execute on function public.ingest_message(text, text, text, text) to anon, authenticated;
