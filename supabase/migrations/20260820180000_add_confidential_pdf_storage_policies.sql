-- Confidential PDF Storage access policies and per-inspection server-side limits.
-- The private bucket itself is created through the supported Supabase Storage API/Dashboard,
-- not by this migration.

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

revoke all on function private.docinspector_enforce_confidential_document_limits() from public, anon, authenticated;

drop trigger if exists docinspector_project_documents_enforce_limits
  on public.docinspector_project_documents;

create trigger docinspector_project_documents_enforce_limits
before insert or update of workspace_id, inspection_id, plaintext_size, status
on public.docinspector_project_documents
for each row execute function private.docinspector_enforce_confidential_document_limits();

drop policy if exists docinspector_confidential_pdf_select on storage.objects;
create policy docinspector_confidential_pdf_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'docinspector-confidential-pdfs'
  and exists (
    select 1
    from public.docinspector_project_documents d
    join public.docinspector_workspace_members m
      on m.workspace_id = d.workspace_id
     and m.user_id = (select auth.uid())
     and m.active
    join public.docinspector_workspace_key_envelopes e
      on e.workspace_id = d.workspace_id
     and e.key_version = d.workspace_key_version
     and e.member_user_id = (select auth.uid())
    where d.object_path = storage.objects.name
      and d.status = 'ACTIVE'
  )
);

drop policy if exists docinspector_confidential_pdf_insert on storage.objects;
create policy docinspector_confidential_pdf_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'docinspector-confidential-pdfs'
  and exists (
    select 1
    from public.docinspector_project_documents d
    join public.docinspector_workspace_members m
      on m.workspace_id = d.workspace_id
     and m.user_id = (select auth.uid())
     and m.active
     and m.role in ('ADMIN', 'INSPECTOR')
    join public.docinspector_workspace_key_envelopes e
      on e.workspace_id = d.workspace_id
     and e.key_version = d.workspace_key_version
     and e.member_user_id = (select auth.uid())
    where d.object_path = storage.objects.name
      and d.created_by = (select auth.uid())
      and d.status = 'UPLOADING'
  )
);

drop policy if exists docinspector_confidential_pdf_delete on storage.objects;
create policy docinspector_confidential_pdf_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'docinspector-confidential-pdfs'
  and exists (
    select 1
    from public.docinspector_project_documents d
    join public.docinspector_workspace_members m
      on m.workspace_id = d.workspace_id
     and m.user_id = (select auth.uid())
     and m.active
     and m.role in ('ADMIN', 'INSPECTOR')
    where d.object_path = storage.objects.name
      and d.status in ('UPLOADING', 'DELETED')
  )
);
