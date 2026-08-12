-- DocInspector — schema estável v6 (compatível com app v0.9.8)
-- Execute todo este arquivo no SQL Editor do seu projeto Supabase.
-- É seguro reexecutar o script para atualizar uma instalação anterior.
--
-- Segurança desta versão:
--   * As tabelas não são acessíveis diretamente pela Publishable Key.
--   * O navegador só lê/escreve por funções RPC SECURITY DEFINER.
--   * Cada operação RPC exige workspace_id + uma chave secreta forte.
--   * A chave secreta é armazenada apenas como SHA-256 no banco.
--
-- Compatibilidade: os nomes internos sky17_* são preservados para não quebrar
-- instalações e sincronizações já existentes do projeto anterior.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.sky17_workspaces (
  id uuid primary key,
  name text not null default 'DocInspector',
  secret_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sky17_inspections (
  id uuid not null,
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  payload jsonb not null,
  device_id text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

-- Migração do schema 3: a versão anterior usava id como chave primária global.
-- Isso impedia reutilizar a mesma inspeção em dois espaços diferentes.
do $$
declare
  current_pk text;
  pk_columns text[];
begin
  select c.conname, array_agg(a.attname order by u.ordinality)
    into current_pk, pk_columns
  from pg_constraint c
  join lateral unnest(c.conkey) with ordinality as u(attnum, ordinality) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
  where c.conrelid = 'public.sky17_inspections'::regclass
    and c.contype = 'p'
  group by c.conname;

  if current_pk is not null and pk_columns <> array['workspace_id','id']::text[] then
    execute format('alter table public.sky17_inspections drop constraint %I', current_pk);
    alter table public.sky17_inspections
      add constraint sky17_inspections_pkey primary key (workspace_id, id);
  elsif current_pk is null then
    alter table public.sky17_inspections
      add constraint sky17_inspections_pkey primary key (workspace_id, id);
  end if;
end $$;

create table if not exists public.sky17_deletions (
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  inspection_id uuid not null,
  device_id text,
  deleted_at timestamptz not null default now(),
  primary key (workspace_id, inspection_id)
);

create index if not exists sky17_inspections_workspace_idx
  on public.sky17_inspections(workspace_id);
create index if not exists sky17_deletions_workspace_idx
  on public.sky17_deletions(workspace_id);

alter table public.sky17_workspaces enable row level security;
alter table public.sky17_inspections enable row level security;
alter table public.sky17_deletions enable row level security;

-- Nenhuma leitura/escrita direta nas tabelas pelo cliente web.
revoke all on table public.sky17_workspaces from anon, authenticated;
revoke all on table public.sky17_inspections from anon, authenticated;
revoke all on table public.sky17_deletions from anon, authenticated;

-- Remove políticas antigas da v0.3.0/v0.3.1, se existirem.
drop policy if exists sky17_inspections_select on public.sky17_inspections;
drop policy if exists sky17_inspections_insert on public.sky17_inspections;
drop policy if exists sky17_inspections_update on public.sky17_inspections;
drop policy if exists sky17_inspections_delete on public.sky17_inspections;
drop policy if exists sky17_deletions_select on public.sky17_deletions;
drop policy if exists sky17_deletions_insert on public.sky17_deletions;
drop policy if exists sky17_deletions_update on public.sky17_deletions;
drop policy if exists sky17_deletions_delete on public.sky17_deletions;

create or replace function public.sky17_secret_hash(p_secret text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex');
$$;

revoke all on function public.sky17_secret_hash(text) from public;

create or replace function public.sky17_has_workspace_access(
  p_workspace_id uuid,
  p_secret text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sky17_workspaces w
    where w.id = p_workspace_id
      and w.secret_hash = public.sky17_secret_hash(p_secret)
  );
$$;

revoke all on function public.sky17_has_workspace_access(uuid, text) from public;

create or replace function public.sky17_schema_version()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select 6;
$$;

revoke all on function public.sky17_schema_version() from public;
grant execute on function public.sky17_schema_version() to anon, authenticated;

create or replace function public.sky17_create_workspace(
  p_workspace_id uuid,
  p_name text,
  p_secret text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_workspace_id is null then
    raise exception 'workspace_id obrigatório';
  end if;
  if length(coalesce(p_secret, '')) < 32 then
    raise exception 'chave de sincronização inválida';
  end if;

  insert into public.sky17_workspaces (id, name, secret_hash)
  values (
    p_workspace_id,
    left(coalesce(nullif(trim(p_name), ''), 'DocInspector'), 80),
    public.sky17_secret_hash(p_secret)
  )
  on conflict (id) do nothing;

  if not public.sky17_has_workspace_access(p_workspace_id, p_secret) then
    raise exception 'este identificador de espaço já existe com outra chave';
  end if;

  return true;
end;
$$;

revoke all on function public.sky17_create_workspace(uuid, text, text) from public;
grant execute on function public.sky17_create_workspace(uuid, text, text) to anon, authenticated;

create or replace function public.sky17_verify_workspace(
  p_workspace_id uuid,
  p_secret text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.sky17_has_workspace_access(p_workspace_id, p_secret);
$$;

revoke all on function public.sky17_verify_workspace(uuid, text) from public;
grant execute on function public.sky17_verify_workspace(uuid, text) to anon, authenticated;

create or replace function public.sky17_pull_inspections(
  p_workspace_id uuid,
  p_secret text
)
returns table (
  id uuid,
  payload jsonb,
  updated_at timestamptz,
  device_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.sky17_has_workspace_access(p_workspace_id, p_secret) then
    raise exception 'acesso negado ao espaço de sincronização';
  end if;

  return query
    select i.id, i.payload, i.updated_at, i.device_id
    from public.sky17_inspections i
    where i.workspace_id = p_workspace_id
    order by i.updated_at asc;
end;
$$;

revoke all on function public.sky17_pull_inspections(uuid, text) from public;
grant execute on function public.sky17_pull_inspections(uuid, text) to anon, authenticated;

create or replace function public.sky17_pull_deletions(
  p_workspace_id uuid,
  p_secret text
)
returns table (
  inspection_id uuid,
  deleted_at timestamptz,
  device_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.sky17_has_workspace_access(p_workspace_id, p_secret) then
    raise exception 'acesso negado ao espaço de sincronização';
  end if;

  return query
    select d.inspection_id, d.deleted_at, d.device_id
    from public.sky17_deletions d
    where d.workspace_id = p_workspace_id
    order by d.deleted_at asc;
end;
$$;

revoke all on function public.sky17_pull_deletions(uuid, text) from public;
grant execute on function public.sky17_pull_deletions(uuid, text) to anon, authenticated;

create or replace function public.sky17_upsert_inspection(
  p_workspace_id uuid,
  p_secret text,
  p_inspection_id uuid,
  p_payload jsonb,
  p_device_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.sky17_has_workspace_access(p_workspace_id, p_secret) then
    raise exception 'acesso negado ao espaço de sincronização';
  end if;
  if p_inspection_id is null or p_payload is null then
    raise exception 'inspeção inválida';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload da inspeção deve ser um objeto JSON';
  end if;
  if pg_column_size(p_payload) > 12582912 then
    raise exception 'payload da inspeção excede o limite de 12 MB';
  end if;
  if jsonb_typeof(p_payload->'documents') <> 'array' then
    raise exception 'payload da inspeção sem lista de documentos válida';
  end if;
  if jsonb_array_length(p_payload->'documents') > 50000 then
    raise exception 'a inspeção excede o limite de 50.000 documentos';
  end if;
  if coalesce(p_payload->>'id', '') <> p_inspection_id::text then
    raise exception 'o id do payload não corresponde ao id da inspeção';
  end if;
  if exists (
    select 1
    from public.sky17_deletions d
    where d.workspace_id = p_workspace_id
      and d.inspection_id = p_inspection_id
  ) then
    raise exception 'esta inspeção foi excluída neste espaço';
  end if;

  insert into public.sky17_inspections (id, workspace_id, payload, device_id, updated_at)
  values (p_inspection_id, p_workspace_id, p_payload, left(coalesce(p_device_id, ''), 120), now())
  on conflict (workspace_id, id) do update
    set payload = excluded.payload,
        device_id = excluded.device_id,
        updated_at = now()
    where public.sky17_inspections.workspace_id = p_workspace_id;

  return true;
end;
$$;

revoke all on function public.sky17_upsert_inspection(uuid, text, uuid, jsonb, text) from public;
grant execute on function public.sky17_upsert_inspection(uuid, text, uuid, jsonb, text) to anon, authenticated;

create or replace function public.sky17_delete_inspection(
  p_workspace_id uuid,
  p_secret text,
  p_inspection_id uuid,
  p_device_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.sky17_has_workspace_access(p_workspace_id, p_secret) then
    raise exception 'acesso negado ao espaço de sincronização';
  end if;
  if p_inspection_id is null then
    raise exception 'inspection_id obrigatório';
  end if;

  insert into public.sky17_deletions (workspace_id, inspection_id, device_id, deleted_at)
  values (p_workspace_id, p_inspection_id, left(coalesce(p_device_id, ''), 120), now())
  on conflict (workspace_id, inspection_id) do update
    set device_id = excluded.device_id,
        deleted_at = greatest(public.sky17_deletions.deleted_at, excluded.deleted_at);

  delete from public.sky17_inspections
  where workspace_id = p_workspace_id
    and id = p_inspection_id;

  return true;
end;
$$;

revoke all on function public.sky17_delete_inspection(uuid, text, uuid, text) from public;
grant execute on function public.sky17_delete_inspection(uuid, text, uuid, text) to anon, authenticated;

-- Higiene adicional: remove as funções antigas da v0.3.0/v0.3.1 baseadas em request.headers.
drop function if exists public.sky17_has_workspace_access(uuid);
drop function if exists public.sky17_request_headers();

-- ---------------------------------------------------------------------------
-- Evidências fotográficas — schema v5
-- ---------------------------------------------------------------------------
-- Bucket privado. O acesso é liberado por RLS somente quando as requisições
-- carregam o workspace e a chave de sincronização do DocInspector.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'docinspector-evidence',
  'docinspector-evidence',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.sky17_storage_object_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  headers jsonb;
  workspace_text text;
  secret_text text;
begin
  headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  workspace_text := headers->>'x-docinspector-workspace';
  secret_text := headers->>'x-docinspector-secret';

  if workspace_text is null
     or secret_text is null
     or workspace_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  if split_part(coalesce(p_name, ''), '/', 1) <> workspace_text then
    return false;
  end if;

  return public.sky17_has_workspace_access(workspace_text::uuid, secret_text);
exception
  when others then
    return false;
end;
$$;

revoke all on function public.sky17_storage_object_allowed(text) from public;
grant execute on function public.sky17_storage_object_allowed(text) to anon, authenticated;

drop policy if exists docinspector_evidence_select on storage.objects;
drop policy if exists docinspector_evidence_insert on storage.objects;
drop policy if exists docinspector_evidence_update on storage.objects;
drop policy if exists docinspector_evidence_delete on storage.objects;

create policy docinspector_evidence_select
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'docinspector-evidence'
  and public.sky17_storage_object_allowed(name)
);

create policy docinspector_evidence_insert
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'docinspector-evidence'
  and public.sky17_storage_object_allowed(name)
);

create policy docinspector_evidence_update
on storage.objects for update
to anon, authenticated
using (
  bucket_id = 'docinspector-evidence'
  and public.sky17_storage_object_allowed(name)
)
with check (
  bucket_id = 'docinspector-evidence'
  and public.sky17_storage_object_allowed(name)
);

create policy docinspector_evidence_delete
on storage.objects for delete
to anon, authenticated
using (
  bucket_id = 'docinspector-evidence'
  and public.sky17_storage_object_allowed(name)
);
