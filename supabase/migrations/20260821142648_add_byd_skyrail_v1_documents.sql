-- BYD Skyrail V1: biblioteca documental simples para consulta offline em campo.
-- Escopo intencionalmente mínimo: um registro por documento/revisão vigente.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  code text not null check (char_length(btrim(code)) between 1 and 160),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  discipline text not null check (char_length(btrim(discipline)) between 1 and 160),
  revision text not null check (char_length(btrim(revision)) between 1 and 80),
  file_path text not null check (char_length(btrim(file_path)) between 1 and 1024),
  updated_at timestamptz not null default now(),
  active boolean not null default true,
  constraint documents_workspace_code_key unique (workspace_id, code)
);

create index if not exists documents_workspace_active_idx
  on public.documents (workspace_id, active, discipline, code);

alter table public.documents enable row level security;

revoke all on table public.documents from anon;
revoke all on table public.documents from authenticated;
grant select, insert, update on table public.documents to authenticated;

drop policy if exists byd_skyrail_documents_select on public.documents;
create policy byd_skyrail_documents_select
on public.documents
for select
to authenticated
using (
  exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and (documents.active or m.role = 'ADMIN')
  )
);

drop policy if exists byd_skyrail_documents_insert_admin on public.documents;
create policy byd_skyrail_documents_insert_admin
on public.documents
for insert
to authenticated
with check (
  exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
);

drop policy if exists byd_skyrail_documents_update_admin on public.documents;
create policy byd_skyrail_documents_update_admin
on public.documents
for update
to authenticated
using (
  exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
)
with check (
  exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'byd-skyrail-documents',
  'byd-skyrail-documents',
  false,
  104857600,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists byd_skyrail_storage_select on storage.objects;
create policy byd_skyrail_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'byd-skyrail-documents'
  and exists (
    select 1
    from public.documents d
    join public.docinspector_workspace_members m
      on m.workspace_id = d.workspace_id
     and m.user_id = (select auth.uid())
     and m.active
    where d.file_path = objects.name
      and d.workspace_id::text = split_part(objects.name, '/', 1)
      and (d.active or m.role = 'ADMIN')
  )
);

drop policy if exists byd_skyrail_storage_insert_admin on storage.objects;
create policy byd_skyrail_storage_insert_admin
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'byd-skyrail-documents'
  and exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id::text = split_part(objects.name, '/', 1)
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
);

drop policy if exists byd_skyrail_storage_delete_admin on storage.objects;
create policy byd_skyrail_storage_delete_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'byd-skyrail-documents'
  and exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id::text = split_part(objects.name, '/', 1)
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
);
