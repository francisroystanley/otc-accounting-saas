-- Harden storage.objects RLS for the `documents` bucket (R28a).
--
-- Two defects in the original policies (migration 4):
--
-- 1. `(storage.foldername(name))[1]::uuid` raises SQLSTATE 22P02 on malformed
--    keys (e.g., a leading slash yielding an empty first segment). Any such
--    object in the bucket breaks LIST for legitimate users because RLS is
--    evaluated per-row and the raise bubbles up as a 500 instead of a clean
--    denial.
--
-- 2. `wsA/../wsB/evil.pdf` yields `foldername = {wsA, '..', wsB}` and
--    `[1] = wsA`, so the policy accepts the write while the effective storage
--    key traverses outside wsA. RLS should not be the layer that permits
--    `..` in a key.
--
-- Fix:
--   - Compare the first segment as text (no cast → no raise).
--   - Reject any key containing `..`.
--   - Enforce flat `<wsId>/<file>` structure (exactly one folder segment).
--
-- Storage paths are server-generated as `${workspaceId}/${uuid}.pdf`, so none
-- of these guards can block a legitimate upload. The user's original
-- filename lives in documents.filename, not in storage.name.

drop policy if exists "documents_bucket_select_if_member" on storage.objects;
drop policy if exists "documents_bucket_insert_if_member" on storage.objects;
drop policy if exists "documents_bucket_update_if_member" on storage.objects;
drop policy if exists "documents_bucket_delete_if_member" on storage.objects;

create policy "documents_bucket_select_if_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] in (
    select workspace_id::text
    from public.workspace_members
    where user_id = (select auth.uid())
  )
  and position('..' in name) = 0
  and array_length(storage.foldername(name), 1) = 1
);

create policy "documents_bucket_insert_if_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] in (
    select workspace_id::text
    from public.workspace_members
    where user_id = (select auth.uid())
  )
  and position('..' in name) = 0
  and array_length(storage.foldername(name), 1) = 1
);

create policy "documents_bucket_update_if_member"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] in (
    select workspace_id::text
    from public.workspace_members
    where user_id = (select auth.uid())
  )
  and position('..' in name) = 0
  and array_length(storage.foldername(name), 1) = 1
)
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] in (
    select workspace_id::text
    from public.workspace_members
    where user_id = (select auth.uid())
  )
  and position('..' in name) = 0
  and array_length(storage.foldername(name), 1) = 1
);

create policy "documents_bucket_delete_if_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] in (
    select workspace_id::text
    from public.workspace_members
    where user_id = (select auth.uid())
  )
  and position('..' in name) = 0
  and array_length(storage.foldername(name), 1) = 1
);
