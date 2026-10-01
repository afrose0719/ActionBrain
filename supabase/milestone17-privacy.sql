-- Run in Supabase -> SQL Editor -> New query -> Run

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
