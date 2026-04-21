-- update_extraction_result (R28f).
--
-- Single write path for extraction-result writes from `/api/extract` and the
-- seed script. SECURITY DEFINER + search_path lockdown + service_role-only
-- EXECUTE grant keep the blast radius tight.
--
-- Not used for user-driven edits on `complete`/`needs_review` rows — those go
-- through a direct UPDATE via the user-session client, where RLS enforces
-- workspace membership (see plan key decision on grant scope).

create or replace function public.update_extraction_result(
  doc_id uuid,
  new_status public.document_status,
  data jsonb,
  error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.documents
  set status = new_status,
      extracted_data = data,
      error_message = error,
      doc_type = case
        when data ? 'doc_type' then data->>'doc_type'
        else doc_type
      end,
      doc_type_confidence = case
        when data ? 'doc_type_confidence' then (data->>'doc_type_confidence')::numeric
        else doc_type_confidence
      end,
      updated_at = now()
  where id = doc_id;
end;
$$;

revoke all on function public.update_extraction_result(uuid, public.document_status, jsonb, text) from public;
revoke all on function public.update_extraction_result(uuid, public.document_status, jsonb, text) from authenticated, anon;
grant execute on function public.update_extraction_result(uuid, public.document_status, jsonb, text) to service_role;
