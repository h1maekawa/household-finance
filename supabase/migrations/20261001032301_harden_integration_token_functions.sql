-- Trigger functions also need a fixed search_path. Unlike the token RPCs this
-- function does not query another relation, but pinning resolution prevents a
-- future unqualified reference from becoming an escalation path.
alter function public.prevent_integration_token_revival()
  set search_path = public;

-- These RPCs intentionally remain SECURITY DEFINER because authenticated users
-- have no direct INSERT/UPDATE/DELETE privilege on the token registry. Keep the
-- callable boundary explicit: never expose either function to anon or PUBLIC.
revoke all on function public.issue_integration_token(text, text, text) from anon, public;
revoke all on function public.revoke_integration_token(uuid) from anon, public;
grant execute on function public.issue_integration_token(text, text, text) to authenticated;
grant execute on function public.revoke_integration_token(uuid) to authenticated;
