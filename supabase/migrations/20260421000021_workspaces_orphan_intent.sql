-- Document workspaces orphan behavior on user deletion.
-- Same doc-intent pattern as migrations 13 and 20.

comment on table public.workspaces is
  'Workspaces are NOT auto-deleted when the last member leaves. Deleting a '
  'user via auth.users cascades workspace_members but leaves workspace rows '
  'orphaned (no FK from auth.users to workspaces). Prototype-acceptable; '
  'production should add an AFTER DELETE trigger on workspace_members to '
  'clean up empty workspaces before shipping multi-member/role support.';
