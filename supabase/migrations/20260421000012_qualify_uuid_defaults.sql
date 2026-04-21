-- Qualify `gen_random_uuid()` defaults on workspaces.id and documents.id so
-- they match the project's SECURITY DEFINER discipline (`set search_path =
-- ''` + fully-qualified names) and don't rely on implicit search_path
-- resolution finding pgcrypto under the `extensions` schema.
--
-- pgcrypto stays installed — it's a Supabase-managed extension and auth
-- internals may depend on it. This migration only adjusts our own defaults.

alter table public.workspaces
  alter column id set default extensions.gen_random_uuid();

alter table public.documents
  alter column id set default extensions.gen_random_uuid();
