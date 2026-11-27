-- Run in Supabase -> SQL Editor -> New query -> Run
-- (Safe to run more than once. Already included in schema.sql for fresh projects.)
-- After it, create the worker login ONCE (see the bottom of this file and docs/zero-touch.md).

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
