-- Workspace auto-create on first signup (R2).
-- Runs in the auth.users INSERT transaction so a verified user always has a
-- workspace by the time their session is issued — no race window.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
begin
  insert into public.workspaces (name)
  values (coalesce(new.email, 'New') || '''s Workspace')
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

-- Restrict direct execution: only the trigger context (service_role/postgres)
-- and the auth owner should invoke this. Callers going through the trigger do
-- not need EXECUTE grants because the function runs as its definer.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from authenticated, anon;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
