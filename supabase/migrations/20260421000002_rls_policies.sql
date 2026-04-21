-- Row Level Security policies.
-- All three public tables are scoped via workspace membership. Writes to
-- workspaces / workspace_members only happen through the workspace-autocreate
-- trigger (SECURITY DEFINER) or service-role paths, so no INSERT/UPDATE/DELETE
-- policies are granted to authenticated users on those tables — default-deny
-- applies.

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.documents enable row level security;

-- ---------------------------------------------------------------------------
-- workspaces
-- A user can see every workspace they are a member of.
-- ---------------------------------------------------------------------------
create policy "workspaces_select_if_member"
on public.workspaces
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = public.workspaces.id
      and wm.user_id = (select auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- workspace_members
-- A user can see their own membership rows. Avoids recursive policy
-- self-reference; co-member visibility is not required for the prototype.
-- ---------------------------------------------------------------------------
create policy "workspace_members_select_own"
on public.workspace_members
for select
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- documents
-- Full CRUD scoped to workspace membership (R3). Realtime CDC events inherit
-- this SELECT policy per row (R28b).
-- ---------------------------------------------------------------------------
create policy "documents_select_if_member"
on public.documents
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = public.documents.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "documents_insert_if_member"
on public.documents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = public.documents.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "documents_update_if_member"
on public.documents
for update
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = public.documents.workspace_id
      and wm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = public.documents.workspace_id
      and wm.user_id = (select auth.uid())
  )
);

create policy "documents_delete_if_member"
on public.documents
for delete
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = public.documents.workspace_id
      and wm.user_id = (select auth.uid())
  )
);
