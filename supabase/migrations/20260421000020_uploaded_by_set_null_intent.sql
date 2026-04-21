-- Document documents.uploaded_by's ON DELETE SET NULL as intentional.
-- When the uploading user is removed from auth.users, the document row
-- remains with uploaded_by=NULL so audit history survives the user's
-- deletion. Same comment pattern used for workspace_id's cascade in
-- migration 13; this is the cousin column.

comment on column public.documents.uploaded_by is
  'ON DELETE SET NULL is intentional: deleting the uploading user leaves '
  'the document row intact with uploaded_by=NULL, preserving audit history. '
  'UI must tolerate null uploader attribution.';
