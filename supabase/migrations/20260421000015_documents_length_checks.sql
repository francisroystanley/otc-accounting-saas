-- Data-layer length caps on documents.filename and documents.storage_path.
-- Zod at U9's upload boundary enforces the same 255-char filename rule, but
-- the CHECK is the source of truth: any write path (service-role scripts,
-- future migrations, ad-hoc RPC) that bypasses Zod still hits the constraint.
--
-- Caps:
--   filename ≤ 255      — matches plan U9's server-side validation.
--   storage_path ≤ 1024 — server-generated as `${workspace_id}/${uuid}.pdf`
--                         (77 chars today); 13× headroom for future path
--                         schema changes.

alter table public.documents
  add constraint documents_filename_length_check
    check (char_length(filename) between 1 and 255),
  add constraint documents_storage_path_length_check
    check (char_length(storage_path) between 1 and 1024);
