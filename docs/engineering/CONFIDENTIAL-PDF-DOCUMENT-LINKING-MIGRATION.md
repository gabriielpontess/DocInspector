# Confidential PDF document linking — migration impact and rollback

## Scope of this migration

Migration: `supabase/migrations/20260821111500_add_confidential_pdf_document_linking.sql`.

This migration is additive with respect to existing E2EE document rows:

- adds nullable `document_id uuid` to `public.docinspector_project_documents`;
- adds the approved partial lookup index on `(workspace_id, inspection_id, document_id, created_at)` for non-deleted linked rows;
- adds a singleton runtime configuration row for `max_files_per_inspection`, initially `10`;
- replaces only the existing per-inspection limit trigger function so it reads the quantity cap from that runtime configuration;
- keeps the existing `20 MiB` per-file and `200 MiB` aggregate caps unchanged.

`document_id` is not a physical foreign key. It is a semantic reference to `sky17_inspections.payload.documents[*].id` while inspection documents remain embedded in JSONB.

The migration does **not** update, decrypt, re-encrypt or rewrite:

- `metadata_ciphertext` / `metadata_iv`;
- wrapped file keys or workspace keys;
- ciphertext hashes or object paths;
- any object in Supabase Storage;
- inspection JSON payloads.

Existing PDF rows receive `document_id = NULL` automatically and remain readable/listable by `inspection_id` exactly as before.

## Runtime quantity configuration

The pilot remains capped at 10 PDFs per inspection. The quantity is stored once in:

```sql
select max_files_per_inspection
from public.docinspector_confidential_pdf_config
where singleton_key = 'global';
```

Authenticated clients have read-only access. They receive no INSERT/UPDATE/DELETE grant on this table.

A future increase, after storage capacity has been explicitly approved, is configuration/DML only and does not require another schema migration:

```sql
update public.docinspector_confidential_pdf_config
set max_files_per_inspection = <approved_limit>
where singleton_key = 'global';
```

Do not raise this value merely because the application supports more inspection documents. Storage capacity remains an independent operational gate.

## Pre-apply gate for production

Before applying this migration to production:

1. Confirm the deployed frontend version before the change is available for immediate rollback.
2. Confirm a normal production backup/snapshot exists according to the current Supabase operating procedure.
3. Record current row counts for `docinspector_project_documents` and confirm existing rows are readable by `inspection_id`.
4. Confirm no deployment in the same window modifies E2EE ciphertext, key rotation, Storage paths or the inspection JSON model.
5. Review the migration SQL and regression test results from the feature branch.

## Rollback order

Rollback must preserve ciphertext and encrypted metadata. Do not delete Storage objects.

1. Revert the frontend to the previously deployed version.
2. Verify that existing PDFs can still be listed and opened by `inspection_id` with the previous frontend.
3. Restore the previous `private.docinspector_enforce_confidential_document_limits()` function definition, with the current pilot caps of 10 files and 200 MiB aggregate, before removing the runtime config table.
4. Drop policy `docinspector_confidential_pdf_config_select_authenticated`, revoke/remove the config table, then drop `public.docinspector_confidential_pdf_config`.
5. Drop index `public.docinspector_project_documents_document_idx`.
6. Drop column `public.docinspector_project_documents.document_id`.

The schema rollback intentionally discards only PDF-to-document associations stored in `document_id`. It must not alter ciphertext, FEK/WK material, metadata ciphertext, hashes, object paths or Storage objects.

## Previous trigger definition to restore during rollback

```sql
create or replace function private.docinspector_enforce_confidential_document_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_total bigint;
begin
  if new.status not in ('UPLOADING', 'ACTIVE') then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.workspace_id::text || ':' || new.inspection_id::text, 0)
  );

  select count(*)::integer, coalesce(sum(d.plaintext_size), 0)::bigint
    into v_count, v_total
  from public.docinspector_project_documents d
  where d.workspace_id = new.workspace_id
    and d.inspection_id = new.inspection_id
    and d.status in ('UPLOADING', 'ACTIVE')
    and d.id <> new.id;

  if v_count >= 10 then
    raise exception 'A inspeção atingiu o limite de 10 PDFs confidenciais.'
      using errcode = '23514';
  end if;

  if v_total + new.plaintext_size > 209715200 then
    raise exception 'A inspeção excederia o limite agregado de 200 MiB de PDFs confidenciais.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.docinspector_enforce_confidential_document_limits()
  from public, anon, authenticated;
```

After rollback, re-run the existing E2EE PDF lifecycle smoke test before any further deployment.
