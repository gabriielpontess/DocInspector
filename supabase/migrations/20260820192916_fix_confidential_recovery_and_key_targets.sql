-- Phase 5 E2EE provisioning/recovery prerequisites.
-- Fixes the recovery-salt constraint to match CONFIDENTIAL_CRYPTO_VERSION=1
-- and exposes narrowly-scoped ADMIN-only key management RPCs.

alter table public.docinspector_member_key_backups
  drop constraint if exists docinspector_member_key_backups_salt_length_check;

alter table public.docinspector_member_key_backups
  add constraint docinspector_member_key_backups_salt_length_check
  check (octet_length(hkdf_salt) = 16);

drop policy if exists docinspector_member_key_backups_update_own
  on public.docinspector_member_key_backups;

create policy docinspector_member_key_backups_update_own
on public.docinspector_member_key_backups
for update
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_key_backups.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_key_backups.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create or replace function public.docinspector_crypto_key_targets(p_workspace_id uuid)
returns table (
  user_id uuid,
  role text,
  key_version integer,
  public_jwk jsonb,
  fingerprint_sha256 text,
  has_current_envelope boolean
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
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  ) then
    raise exception 'ADMIN membership required.' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    m.role,
    k.key_version,
    k.public_jwk,
    k.fingerprint_sha256,
    exists (
      select 1
      from public.docinspector_workspace_crypto_keys wk
      join public.docinspector_workspace_key_envelopes e
        on e.workspace_id = wk.workspace_id
       and e.key_version = wk.key_version
       and e.member_user_id = m.user_id
      where wk.workspace_id = p_workspace_id
        and wk.status = 'ACTIVE'
    ) as has_current_envelope
  from public.docinspector_workspace_members m
  join public.docinspector_member_public_keys k
    on k.workspace_id = m.workspace_id
   and k.user_id = m.user_id
   and k.status = 'ACTIVE'
  where m.workspace_id = p_workspace_id
    and m.active
  order by m.created_at, m.user_id;
end;
$$;

revoke all on function public.docinspector_crypto_key_targets(uuid) from public, anon;
grant execute on function public.docinspector_crypto_key_targets(uuid) to authenticated;

create or replace function public.docinspector_initialize_workspace_crypto(
  p_workspace_id uuid,
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
  v_key_version integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.docinspector_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = v_user_id
      and m.active
      and m.role = 'ADMIN'
  ) then
    raise exception 'ADMIN membership required.' using errcode = '42501';
  end if;

  if p_member_key_version is null or p_member_key_version <= 0
     or octet_length(p_wrapped_workspace_key) < 384 then
    raise exception 'Invalid cryptographic envelope.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.docinspector_member_public_keys k
    where k.workspace_id = p_workspace_id
      and k.user_id = v_user_id
      and k.key_version = p_member_key_version
      and k.status = 'ACTIVE'
  ) then
    raise exception 'Active member public key required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('docinspector:workspace-key:' || p_workspace_id::text, 0));

  if exists (
    select 1
    from public.docinspector_workspace_crypto_keys wk
    where wk.workspace_id = p_workspace_id
      and wk.status in ('ACTIVE', 'ROTATING')
  ) then
    raise exception 'Workspace cryptographic key already initialized or rotating.' using errcode = '23505';
  end if;

  select coalesce(max(wk.key_version), 0) + 1
    into v_key_version
  from public.docinspector_workspace_crypto_keys wk
  where wk.workspace_id = p_workspace_id;

  insert into public.docinspector_workspace_crypto_keys (
    workspace_id,
    key_version,
    status,
    created_by,
    activated_at
  ) values (
    p_workspace_id,
    v_key_version,
    'ACTIVE',
    v_user_id,
    now()
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
    v_key_version,
    v_user_id,
    p_member_key_version,
    p_wrapped_workspace_key,
    v_user_id
  );

  return v_key_version;
end;
$$;

revoke all on function public.docinspector_initialize_workspace_crypto(uuid, integer, bytea) from public, anon;
grant execute on function public.docinspector_initialize_workspace_crypto(uuid, integer, bytea) to authenticated;
