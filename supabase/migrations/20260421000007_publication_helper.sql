-- Verification helper for R17/R28b.
--
-- `pg_catalog.pg_publication_tables` is not exposed through PostgREST's
-- `public` schema, so the U3 harness cannot assert publication membership
-- with a plain REST query. This SECURITY DEFINER function wraps the lookup
-- so the harness (and any future CI check) can verify via `/rpc/` with the
-- service-role key. Blast radius: read-only lookup against pg_catalog; no
-- write surface; grantable to service_role only.

create or replace function public.publication_has_documents()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'documents'
  );
$$;

revoke all on function public.publication_has_documents() from public;
revoke all on function public.publication_has_documents() from authenticated, anon;
grant execute on function public.publication_has_documents() to service_role;
