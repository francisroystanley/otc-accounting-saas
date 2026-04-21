-- Drop redundant single-column index on documents(workspace_id).
--
-- The left-prefix of either composite index — (workspace_id, status) or
-- (workspace_id, created_at desc) — serves any query that filters on
-- workspace_id alone. The single-column index pays write-amplification
-- on every INSERT/UPDATE with no unique read value.

drop index if exists public.documents_workspace_id_idx;
