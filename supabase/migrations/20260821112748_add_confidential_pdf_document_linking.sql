-- Link confidential engineering PDFs to a specific document inside an inspection.
-- Additive-only: existing E2EE ciphertext, key material and Storage objects are untouched.
--
-- `document_id` is a semantic reference to sky17_inspections.payload.documents[*].id.
-- A physical FK is intentionally impossible while inspection documents remain inside JSONB.
-- NULL means the PDF is intentionally/unavoidably unlinked.
--
-- The per-inspection file-count limit is moved to one runtime configuration row so a
-- future increase is DML/configuration only and does not require another schema migration.

create table public.docinspector_confidential_pdf_config (
  singleton_key text primary key,
  max_files_per_inspection integer not null,
  constraint docinspector_confidential_pdf_config_singleton_check
    check (singleton_key = 'global'),
  constraint docinspector_confidential_pdf_config_max_files_check
    check (max_files_per_inspection > 0)
);

insert into public.docinspector_confidential_pdf_config (
  singleton_key,
  max_files_per_inspection
) values ('global', 10);

alter table public.docinspector_confidential_pdf_config enable row level security;

revoke all on table public.docinspector_confidential_pdf_config from anon, authenticated;
grant select on table public.docinspector_confidential_pdf_config to authenticated;

create policy docinspector_confidential_pdf_config_select_authenticated
on public.docinspector_confidential_pdf_config
for select
to authenticated
using (true);

alter table public.docinspector_project_documents
  add column document_id uuid null;

create index docinspector_project_documents_document_idx
  on public.docinspector_project_documents (
    workspace_id,
    inspection_id,
    document_id,
    created_at
  )
  where status <> 'DELETED'
    and document_id is not null;

create or replace function private.docinspector_enforce_confidential_document_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
  v_total bigint;
  v_max_files integer;
begin
  if new.status not in ('UPLOADING', 'ACTIVE') then
    return new;
  end if;

  select c.max_files_per_inspection
    into v_max_files
  from public.docinspector_confidential_pdf_config c
  where c.singleton_key = 'global';

  if v_max_files is null or v_max_files < 1 then
    raise exception 'Configuração do limite de PDFs confidenciais indisponível.'
      using errcode = '55000';
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

  if v_count >= v_max_files then
    raise exception 'A inspeção atingiu o limite de % PDFs confidenciais.', v_max_files
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
