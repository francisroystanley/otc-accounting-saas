-- Add `default null` to `data` and `error` so `supabase gen types typescript`
-- emits them as optional + nullable (`data?: Json | null`, `error?: string | null`).
--
-- Previously the SQL signature declared `data jsonb, error text` with no
-- defaults, so the generated TS types marked both as non-nullable-and-required.
-- Call paths that legitimately pass null (success: error=null, failure:
-- data=null) had to reach for `as unknown as ...` or `@ts-expect-error`,
-- both banned by R32. This migration aligns the generated contract with
-- the runtime reality; nothing about the function body or behavior changes.
--
-- Body is identical to migration 9 — only the arg defaults change.

create or replace function public.update_extraction_result(
  doc_id uuid,
  new_status public.document_status,
  data jsonb default null,
  error text default null
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

revoke all on function public.update_extraction_result(uuid, public.document_status, jsonb, text) from public;
revoke all on function public.update_extraction_result(uuid, public.document_status, jsonb, text) from authenticated, anon;
grant execute on function public.update_extraction_result(uuid, public.document_status, jsonb, text) to service_role;
