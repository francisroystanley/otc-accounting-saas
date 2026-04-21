-- Cap workspaces.name length.
--
-- Two-layer fix:
--   1. Truncate the embedded email in handle_new_user to 80 chars so normal
--      operation (trigger-driven workspace creation) never produces a name
--      longer than ~92 chars.
--   2. Add a CHECK on workspaces.name (≤ 200) as declarative backstop for
--      any future code path that writes the column directly.
--
-- Matches the data-layer-length-cap pattern established for documents in
-- migration 15. Body preserves the trigger-context guard from migration 14.

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
  values (left(coalesce(new.email, 'New'), 80) || '''s Workspace')
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from authenticated, anon;

alter table public.workspaces
  add constraint workspaces_name_length_check
    check (char_length(name) between 1 and 200);
