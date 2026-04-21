-- Storage bucket + RLS (R28a).
-- Object keys are shaped `<workspace_id>/<uuid>.pdf`. The first path segment
-- carries the tenant, and RLS mirrors the `documents` table by checking it
-- against the caller's membership set.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents_bucket_select_if_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1]::uuid in (
    select workspace_id
    from public.workspace_members
    where user_id = (select auth.uid())
  )
);

create policy "documents_bucket_insert_if_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1]::uuid in (
    select workspace_id
    from public.workspace_members
    where user_id = (select auth.uid())
  )
);

create policy "documents_bucket_update_if_member"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1]::uuid in (
    select workspace_id
    from public.workspace_members
    where user_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1]::uuid in (
    select workspace_id
    from public.workspace_members
    where user_id = (select auth.uid())
  )
);

create policy "documents_bucket_delete_if_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1]::uuid in (
    select workspace_id
    from public.workspace_members
    where user_id = (select auth.uid())
  )
);
