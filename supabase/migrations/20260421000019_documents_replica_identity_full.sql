-- Set REPLICA IDENTITY FULL on documents so Realtime DELETE events include
-- full old-row data. Without this, the supabase_realtime publication's RLS
-- filter (which evaluates the SELECT policy against the old row) can't see
-- workspace_id on DELETE, fails the membership check, and silently suppresses
-- the event. UI listeners never get told the row was deleted and show stale
-- data until manual refresh — breaking R17 × R20.
--
-- Trade-off: WAL grows because old rows are logged in full on every
-- UPDATE/DELETE. Negligible at demo scale (~100 docs/workspace).

alter table public.documents replica identity full;
