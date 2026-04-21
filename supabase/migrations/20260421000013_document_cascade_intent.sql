-- Annotate documents.workspace_id's ON DELETE CASCADE as intentional for the
-- prototype. Deleting a workspace silently removes every document under it
-- with no soft-delete trail — acceptable for the demo (no admin-delete flow
-- exists), not acceptable in production. Surfacing the decision in the DB
-- itself so future maintainers see it when inspecting the column.

comment on column public.documents.workspace_id is
  'ON DELETE CASCADE is intentional for the prototype: deleting a workspace '
  'removes all documents under it with no soft-delete trail. Revisit to '
  'ON DELETE RESTRICT + soft-delete before shipping any admin-delete flow.';
