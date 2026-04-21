-- Structural defense against tenant-teleport via UPDATE (R3).
--
-- Supabase grants `authenticated` ALL on public tables at project init. That
-- table-level UPDATE overrides any column-level restriction, so the
-- `documents_update_if_member` policy alone does not prevent a user who is
-- a member of two workspaces from PATCHing `workspace_id` to move a document
-- between them (USING matches the old row, WITH CHECK matches the new row,
-- the UPDATE is accepted).
--
-- Strip the table-level grant and re-grant UPDATE only on the columns the
-- R14 / R19 user-driven flows need:
--   - status              (needs_review → complete)
--   - doc_type            (user picks a type from the needs_review picker)
--   - extracted_data      (edit-save on complete rows)
--   - edited_fields       (R13a edited-fields latch)
--   - updated_at          (server-set `now()` on save)
--
-- After this, `workspace_id`, `storage_path`, `uploaded_by`, `created_at`,
-- `doc_type_confidence`, `error_message`, and `filename` are all immutable
-- from the user-session (authenticated) client. Service-role writers
-- (`update_extraction_result`, the seed script) bypass column grants by
-- role, so the extraction pipeline is unaffected.

revoke update on public.documents from authenticated;

grant update (status, doc_type, extracted_data, edited_fields, updated_at)
  on public.documents to authenticated;
