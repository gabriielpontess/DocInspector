-- Phase 7D E2EE hardening: a member that already received workspace crypto
-- material may only be deactivated through the resumable removal/rotation RPC.
-- This closes service-role / future admin-code bypasses around the UI guard.

create or replace function private.docinspector_guard_e2ee_member_deactivation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_guard text;
  v_active_guard text;
begin
  if old.active
     and not new.active
     and exists (
       select 1
       from public.docinspector_workspace_crypto_keys wk
       where wk.workspace_id = old.workspace_id
     ) then
    v_expected_guard := old.workspace_id::text || ':' || old.user_id::text;
    v_active_guard := current_setting('docinspector.e2ee_member_removal', true);

    if v_active_guard is distinct from v_expected_guard then
      raise exception 'Membros de workspace E2EE devem ser removidos pelo fluxo de rotação criptográfica.'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.docinspector_guard_e2ee_member_deactivation()
  from public, anon, authenticated;

drop trigger if exists docinspector_workspace_members_guard_e2ee_deactivation
  on public.docinspector_workspace_members;
create trigger docinspector_workspace_members_guard_e2ee_deactivation
before update of active on public.docinspector_workspace_members
for each row execute function private.docinspector_guard_e2ee_member_deactivation();

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

  -- The trigger below accepts deactivation only while this exact transaction
  -- is executing the approved rotation for this exact workspace/member pair.
  perform pg_catalog.set_config(
    'docinspector.e2ee_member_removal',
    p_workspace_id::text || ':' || p_removed_user_id::text,
    true
  );

  update public.docinspector_workspace_members
  set active = false
  where workspace_id = p_workspace_id
    and user_id = p_removed_user_id
    and active;

  perform pg_catalog.set_config('docinspector.e2ee_member_removal', '', true);

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

revoke all on function public.docinspector_begin_member_removal_rotation(uuid, uuid, integer, integer, bytea)
  from public, anon;
grant execute on function public.docinspector_begin_member_removal_rotation(uuid, uuid, integer, integer, bytea)
  to authenticated;
