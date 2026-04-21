-- Defense-in-depth guard on handle_new_user. The primary isolation is the
-- REVOKE pattern from migration 3 (only service_role / postgres can invoke
-- the function), but this doesn't prevent a future migration or SQL-editor
-- operator from ATTACHING the function to a different trigger (say, on
-- public.workspaces) where it would happily create workspace rows for any
-- NEW record it's handed.
--
-- Add a context check at function entry so the function refuses to run
-- unless it's invoked as the `on_auth_user_created AFTER INSERT ON
-- auth.users` trigger it was designed for.
--
-- Body below migration 3's body unchanged; only the guard clause is new.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
begin
  if tg_when <> 'AFTER'
     or tg_op <> 'INSERT'
     or tg_table_schema <> 'auth'
     or tg_table_name <> 'users' then
    raise exception 'handle_new_user attached incorrectly (expected AFTER INSERT ON auth.users, got %.% % %)',
      tg_table_schema, tg_table_name, tg_when, tg_op;
  end if;

  insert into public.workspaces (name)
  values (coalesce(new.email, 'New') || '''s Workspace')
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from authenticated, anon;
