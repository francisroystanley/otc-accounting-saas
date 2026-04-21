-- Tenant-scope documents.storage_path at the data layer.
--
-- Two problems with the original constraint:
--
-- 1. UNIQUE(storage_path) is global. A user who is a member of workspace A
--    can INSERT a row with workspace_id=wsA and storage_path=<wsB>/<uuid>.pdf
--    and the uniqueness check against an unrelated workspace's row returns
--    a 23505 error naming the constraint — a document-existence oracle.
--
-- 2. Nothing enforces that storage_path's first segment matches
--    documents.workspace_id. The same attacker above could plant a row in
--    wsA whose storage_path references wsB's storage prefix. RLS prevents
--    reading the Storage object, but the metadata mismatch is confusing
--    and a future preview-URL handler could be tricked into requesting a
--    signed URL for a path the row's workspace doesn't actually own.
--
-- Fix:
--   - Replace the global UNIQUE with UNIQUE(workspace_id, storage_path) so
--     paths are unique within a workspace, not across.
--   - Add a CHECK that storage_path begins with `<workspace_id>/`. Server
--     code already generates compliant paths; the CHECK makes the invariant
--     structural and catches any future caller that forgets.

alter table public.documents
  drop constraint if exists documents_storage_path_key;

alter table public.documents
  add constraint documents_storage_path_workspace_unique
    unique (workspace_id, storage_path),
  add constraint documents_storage_path_prefix_check
    check (storage_path like workspace_id::text || '/%');
