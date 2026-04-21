-- Realtime publication (R28b, R17).
-- postgres_changes uses the documents table's RLS SELECT policy per CDC event
-- to filter rows before broadcasting to the client.

alter publication supabase_realtime add table public.documents;
