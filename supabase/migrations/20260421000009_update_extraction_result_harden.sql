-- Harden update_extraction_result so a bad payload never wedges a row in
-- 'processing' (R12).
--
-- Previously, an off-vocab doc_type (e.g., Gemini returns "W-2" or "W2"
-- instead of lowercase "w2") made the CASE expression write 'W-2' to
-- documents.doc_type, tripping documents_doc_type_check. The whole UPDATE
-- rolled back, so status and error_message were never persisted. QStash
-- redelivery hit the same bad payload and looped until retries exhausted;
-- the row stayed in 'processing' forever with no visible failure signal.
--
-- The hardened version catches check_violation (off-vocab doc_type) and
-- invalid_text_representation (e.g., doc_type_confidence not castable to
-- numeric) from within the function, rolls back to a savepoint, and writes
-- a clean status='failed' row with a diagnostic error_message.
--
-- Well-behaved callers (Zod-validated happy path via U6) see no behavior
-- change. The guard is defense-in-depth against future callers, ad-hoc RPC
-- invocations, and the seed script.

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
exception
  when check_violation or invalid_text_representation then
    update public.documents
    set status = 'failed',
        error_message = left(
          format(
            'update_extraction_result rejected payload: %s (%s). Payload: %s',
            SQLERRM,
            SQLSTATE,
            coalesce(data::text, 'null')
          ),
          2000
        ),
        updated_at = now()
    where id = doc_id;
end;
$$;

-- CREATE OR REPLACE preserves existing grants, but re-apply for auditability.
revoke all on function public.update_extraction_result(uuid, public.document_status, jsonb, text) from public;
revoke all on function public.update_extraction_result(uuid, public.document_status, jsonb, text) from authenticated, anon;
grant execute on function public.update_extraction_result(uuid, public.document_status, jsonb, text) to service_role;
