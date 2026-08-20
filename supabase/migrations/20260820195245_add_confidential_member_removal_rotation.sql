-- Phase 6 E2EE member removal + resumable Workspace Key rotation.
-- The server receives only wrapped WK/FEK ciphertext. PDF Storage objects are never re-encrypted here.

create table private.docinspector_workspace_key_rotations (
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  from_key_version integer not null,
  to_key_version integer not null,
  removed_user_id uuid not null references auth.users(id),
  status text not null default 'ROTATING',
  total_documents integer not null default 0,
  processed_documents integer not null default 0,
  started_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, to_key_version),
  constraint docinspector_workspace_key_rotations_from_fk
    foreign key (workspace_id, from_key_version)
    references public.docinspector_workspace_crypto_keys(workspace_id, key_version),
  constraint docinspector_workspace_key_rotations_to_fk
    foreign key (workspace_id, to_key_version)
    references public.docinspector_workspace_crypto_keys(workspace_id, key_version),
  constraint docinspector_workspace_key_rotations_versions_check
    check (from_key_version > 0 and to_key_version > from_key_version),
  constraint docinspector_workspace_key_rotations_status_check
    check (status in ('ROTATING', 'COMPLETED')),
  constraint docinspector_workspace_key_rotations_progress_check
    check (
      total_documents >= 0
      and processed_documents >= 0
      and processed_documents <= total_documents
      and ((status = 'ROTATING' and completed_at is null) or (status = 'COMPLETED' and completed_at is not null))
    )
);

create unique index docinspector_workspace_key_rotations_one_active_idx
  on private.docinspector_workspace_key_rotations(workspace_id)
  where status = 'ROTATING';

revoke all on table private.docinspector_workspace_key_rotations from public, anon, authenticated;

create or replace function private.docinspector_block_confidential_upload_during_rotation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.docinspector_workspace_crypto_keys wk
    where wk.workspace_id = new.workspace_id
      and wk.status = 'ROTATING'
  ) then
    raise exception 'Uploads confidenciais ficam bloqueados enquanto a Workspace Key está em rotação.'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.docinspector_block_confidential_upload_during_rotation() from public, anon, authenticated;

drop trigger if exists docinspector_project_documents_block_rotation_upload
  on public.docinspector_project_documents;
create trigger docinspector_project_documents_block_rotation_upload
before insert on public.docinspector_project_documents
for each row execute function private.docinspector_block_confidential_upload_during_rotation();

create or replace function public.docinspector_begin_member_removal_rotation(
  p_workspace_id uuid,
  p_removed_user_id uuid,
  p_from_key_version integer,
  p_member_key_version integer,
  p_wrapped_workspace_key bytea
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_to_key_version integer;
  v_total_documents integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_removed_user_id is null or p_removed_user_id = v_user_id then
    raise exception 'A rotação de remoção deve ser iniciada por outro ADMIN.' using errcode = '22023';
  end if;
  if p_from_key_version is null or p_from_key_version <= 0
     or p_member_key_version is null or p_member_key_version <= 0
     or octet_length(p_wrapped_workspace_key) < 384 then
    raise exception 'Invalid cryptographic rotation input.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('docinspector:workspace-key:' || p_workspace_id::text, 0));

  if not exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = v_user_id
      and m.active
      and m.role = 'ADMIN'
  ) then
    raise exception 'ADMIN membership required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = p_removed_user_id
      and m.active
  ) then
    raise exception 'O membro a remover não está ativo.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.docinspector_workspace_crypto_keys wk
    where wk.workspace_id = p_workspace_id and wk.status = 'ROTATING'
  ) then
    raise exception 'Já existe uma rotação de Workspace Key em andamento.' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.docinspector_workspace_crypto_keys wk
    where wk.workspace_id = p_workspace_id
      and wk.key_version = p_from_key_version
      and wk.status = 'ACTIVE'
  ) then
    raise exception 'A versão de origem não é a Workspace Key ativa.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.docinspector_workspace_key_envelopes e
    where e.workspace_id = p_workspace_id
      and e.key_version = p_from_key_version
      and e.member_user_id = v_user_id
  ) then
    raise exception 'O ADMIN atual não possui envelope para a Workspace Key ativa.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.docinspector_member_public_keys k
    where k.workspace_id = p_workspace_id
      and k.user_id = v_user_id
      and k.key_version = p_member_key_version
      and k.status = 'ACTIVE'
  ) then
    raise exception 'Active member public key required.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.docinspector_project_documents d
    where d.workspace_id = p_workspace_id and d.status = 'UPLOADING'
  ) then
    raise exception 'Finalize ou reverta uploads confidenciais pendentes antes da rotação.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.docinspector_project_documents d
    where d.workspace_id = p_workspace_id
      and d.status = 'ACTIVE'
      and d.workspace_key_version <> p_from_key_version
  ) then
    raise exception 'Há PDFs ativos fora da versão de Workspace Key esperada.' using errcode = '55000';
  end if;

  -- Security boundary: deactivate membership before creating the next key version.
  update public.docinspector_workspace_members
  set active = false
  where workspace_id = p_workspace_id
    and user_id = p_removed_user_id
    and active;

  select coalesce(max(wk.key_version), 0) + 1
  into v_to_key_version
  from public.docinspector_workspace_crypto_keys wk
  where wk.workspace_id = p_workspace_id;

  insert into public.docinspector_workspace_crypto_keys (
    workspace_id, key_version, status, created_by
  ) values (
    p_workspace_id, v_to_key_version, 'ROTATING', v_user_id
  );

  insert into public.docinspector_workspace_key_envelopes (
    workspace_id,
    key_version,
    member_user_id,
    member_key_version,
    wrapped_workspace_key,
    created_by
  ) values (
    p_workspace_id,
    v_to_key_version,
    v_user_id,
    p_member_key_version,
    p_wrapped_workspace_key,
    v_user_id
  );

  select count(*)::integer
  into v_total_documents
  from public.docinspector_project_documents d
  where d.workspace_id = p_workspace_id
    and d.status = 'ACTIVE'
    and d.workspace_key_version = p_from_key_version;

  insert into private.docinspector_workspace_key_rotations (
    workspace_id,
    from_key_version,
    to_key_version,
    removed_user_id,
    total_documents,
    started_by
  ) values (
    p_workspace_id,
    p_from_key_version,
    v_to_key_version,
    p_removed_user_id,
    v_total_documents,
    v_user_id
  );

  return v_to_key_version;
end;
$$;

revoke all on function public.docinspector_begin_member_removal_rotation(uuid, uuid, integer, integer, bytea) from public, anon;
grant execute on function public.docinspector_begin_member_removal_rotation(uuid, uuid, integer, integer, bytea) to authenticated;

create or replace function public.docinspector_workspace_rotation_status(p_workspace_id uuid)
returns table (
  workspace_id uuid,
  from_key_version integer,
  to_key_version integer,
  removed_user_id uuid,
  status text,
  total_documents integer,
  processed_documents integer,
  remaining_documents integer,
  started_at timestamptz,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  ) then
    raise exception 'ADMIN membership required.' using errcode = '42501';
  end if;

  return query
  select
    r.workspace_id,
    r.from_key_version,
    r.to_key_version,
    r.removed_user_id,
    r.status,
    r.total_documents,
    r.processed_documents,
    greatest(r.total_documents - r.processed_documents, 0),
    r.started_at,
    r.completed_at
  from private.docinspector_workspace_key_rotations r
  where r.workspace_id = p_workspace_id
  order by r.started_at desc
  limit 1;
end;
$$;

revoke all on function public.docinspector_workspace_rotation_status(uuid) from public, anon;
grant execute on function public.docinspector_workspace_rotation_status(uuid) to authenticated;

create or replace function public.docinspector_rewrap_confidential_file_key(
  p_workspace_id uuid,
  p_file_id uuid,
  p_from_key_version integer,
  p_to_key_version integer,
  p_wrapped_file_key bytea
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_changed integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if octet_length(p_wrapped_file_key) <= 28 then
    raise exception 'Invalid encrypted FEK envelope.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  ) then
    raise exception 'ADMIN membership required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.docinspector_workspace_key_rotations r
    where r.workspace_id = p_workspace_id
      and r.from_key_version = p_from_key_version
      and r.to_key_version = p_to_key_version
      and r.status = 'ROTATING'
  ) then
    raise exception 'A rotação informada não está ativa.' using errcode = '55000';
  end if;

  update public.docinspector_project_documents d
  set wrapped_file_key = p_wrapped_file_key,
      workspace_key_version = p_to_key_version
  where d.workspace_id = p_workspace_id
    and d.id = p_file_id
    and d.status = 'ACTIVE'
    and d.workspace_key_version = p_from_key_version;
  get diagnostics v_changed = row_count;

  if v_changed = 1 then
    update private.docinspector_workspace_key_rotations r
    set processed_documents = least(r.total_documents, r.processed_documents + 1)
    where r.workspace_id = p_workspace_id
      and r.to_key_version = p_to_key_version
      and r.status = 'ROTATING';
    return true;
  end if;

  if exists (
    select 1 from public.docinspector_project_documents d
    where d.workspace_id = p_workspace_id
      and d.id = p_file_id
      and d.status = 'ACTIVE'
      and d.workspace_key_version = p_to_key_version
  ) then
    return false;
  end if;

  raise exception 'O PDF não está disponível para rewrap nesta rotação.' using errcode = '55000';
end;
$$;

revoke all on function public.docinspector_rewrap_confidential_file_key(uuid, uuid, integer, integer, bytea) from public, anon;
grant execute on function public.docinspector_rewrap_confidential_file_key(uuid, uuid, integer, integer, bytea) to authenticated;

create or replace function public.docinspector_finish_workspace_rotation(
  p_workspace_id uuid,
  p_from_key_version integer,
  p_to_key_version integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_removed_user_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('docinspector:workspace-key:' || p_workspace_id::text, 0));

  if not exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  ) then
    raise exception 'ADMIN membership required.' using errcode = '42501';
  end if;

  select r.removed_user_id
  into v_removed_user_id
  from private.docinspector_workspace_key_rotations r
  where r.workspace_id = p_workspace_id
    and r.from_key_version = p_from_key_version
    and r.to_key_version = p_to_key_version
    and r.status = 'ROTATING'
  for update;

  if v_removed_user_id is null then
    raise exception 'A rotação informada não está ativa.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = v_removed_user_id
      and m.active
  ) then
    raise exception 'O membro removido foi reativado durante a rotação.' using errcode = '55000';
  end if;

  if exists (
    select 1 from public.docinspector_project_documents d
    where d.workspace_id = p_workspace_id
      and d.status = 'ACTIVE'
      and d.workspace_key_version <> p_to_key_version
  ) then
    raise exception 'Ainda existem PDFs ativos aguardando rewrap de FEK.' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.docinspector_workspace_members m
    join public.docinspector_member_public_keys k
      on k.workspace_id = m.workspace_id
     and k.user_id = m.user_id
     and k.status = 'ACTIVE'
    where m.workspace_id = p_workspace_id
      and m.active
      and not exists (
        select 1 from public.docinspector_workspace_key_envelopes e
        where e.workspace_id = p_workspace_id
          and e.key_version = p_to_key_version
          and e.member_user_id = m.user_id
          and e.member_key_version = k.key_version
      )
  ) then
    raise exception 'Há membros E2EE ativos sem envelope da nova Workspace Key.' using errcode = '55000';
  end if;

  update public.docinspector_workspace_crypto_keys
  set status = 'RETIRED', retired_at = now()
  where workspace_id = p_workspace_id
    and key_version = p_from_key_version
    and status = 'ACTIVE';

  update public.docinspector_workspace_crypto_keys
  set status = 'ACTIVE', activated_at = now()
  where workspace_id = p_workspace_id
    and key_version = p_to_key_version
    and status = 'ROTATING';

  if not found then
    raise exception 'A nova Workspace Key não pôde ser ativada.' using errcode = '55000';
  end if;

  update private.docinspector_workspace_key_rotations r
  set status = 'COMPLETED',
      processed_documents = r.total_documents,
      completed_at = now()
  where r.workspace_id = p_workspace_id
    and r.to_key_version = p_to_key_version
    and r.status = 'ROTATING';

  return true;
end;
$$;

revoke all on function public.docinspector_finish_workspace_rotation(uuid, integer, integer) from public, anon;
grant execute on function public.docinspector_finish_workspace_rotation(uuid, integer, integer) to authenticated;
