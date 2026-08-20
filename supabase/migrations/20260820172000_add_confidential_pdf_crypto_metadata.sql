-- Confidential engineering PDF E2EE metadata foundation.
-- Phase 2 only: schema + RLS. No Storage bucket/object mutation.

create table public.docinspector_member_public_keys (
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_version integer not null,
  algorithm text not null default 'RSA-OAEP-3072-SHA256',
  public_jwk jsonb not null,
  fingerprint_sha256 text not null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (workspace_id, user_id, key_version),
  constraint docinspector_member_public_keys_version_check check (key_version > 0),
  constraint docinspector_member_public_keys_algorithm_check check (algorithm = 'RSA-OAEP-3072-SHA256'),
  constraint docinspector_member_public_keys_status_check check (status in ('ACTIVE','REVOKED')),
  constraint docinspector_member_public_keys_jwk_object_check check (jsonb_typeof(public_jwk) = 'object'),
  constraint docinspector_member_public_keys_public_only_check check (
    not (public_jwk ?| array['d','p','q','dp','dq','qi'])
  ),
  constraint docinspector_member_public_keys_fingerprint_check check (fingerprint_sha256 ~ '^[0-9a-f]{64}$')
);

create unique index docinspector_member_public_keys_one_active_idx
  on public.docinspector_member_public_keys(workspace_id, user_id)
  where status = 'ACTIVE';

create table public.docinspector_member_key_backups (
  workspace_id uuid not null,
  user_id uuid not null,
  key_version integer not null,
  crypto_version text not null default 'MEK-BACKUP-v1',
  encrypted_private_key bytea not null,
  hkdf_salt bytea not null,
  iv bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, key_version),
  constraint docinspector_member_key_backups_public_key_fk
    foreign key (workspace_id, user_id, key_version)
    references public.docinspector_member_public_keys(workspace_id, user_id, key_version)
    on delete cascade,
  constraint docinspector_member_key_backups_version_check check (key_version > 0),
  constraint docinspector_member_key_backups_crypto_version_check check (crypto_version = 'MEK-BACKUP-v1'),
  constraint docinspector_member_key_backups_salt_length_check check (octet_length(hkdf_salt) = 32),
  constraint docinspector_member_key_backups_iv_length_check check (octet_length(iv) = 12),
  constraint docinspector_member_key_backups_ciphertext_check check (octet_length(encrypted_private_key) > 16)
);

create table public.docinspector_workspace_crypto_keys (
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  key_version integer not null,
  status text not null default 'ROTATING',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  primary key (workspace_id, key_version),
  constraint docinspector_workspace_crypto_keys_version_check check (key_version > 0),
  constraint docinspector_workspace_crypto_keys_status_check check (status in ('ROTATING','ACTIVE','RETIRED')),
  constraint docinspector_workspace_crypto_keys_state_times_check check (
    (status = 'ROTATING' and retired_at is null)
    or (status = 'ACTIVE' and activated_at is not null and retired_at is null)
    or (status = 'RETIRED' and activated_at is not null and retired_at is not null)
  )
);

create unique index docinspector_workspace_crypto_keys_one_active_idx
  on public.docinspector_workspace_crypto_keys(workspace_id)
  where status = 'ACTIVE';

create table public.docinspector_workspace_key_envelopes (
  workspace_id uuid not null,
  key_version integer not null,
  member_user_id uuid not null,
  member_key_version integer not null,
  wrapped_workspace_key bytea not null,
  algorithm text not null default 'RSA-OAEP-3072-SHA256',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, key_version, member_user_id),
  constraint docinspector_workspace_key_envelopes_workspace_key_fk
    foreign key (workspace_id, key_version)
    references public.docinspector_workspace_crypto_keys(workspace_id, key_version)
    on delete cascade,
  constraint docinspector_workspace_key_envelopes_member_key_fk
    foreign key (workspace_id, member_user_id, member_key_version)
    references public.docinspector_member_public_keys(workspace_id, user_id, key_version),
  constraint docinspector_workspace_key_envelopes_algorithm_check check (algorithm = 'RSA-OAEP-3072-SHA256'),
  constraint docinspector_workspace_key_envelopes_ciphertext_check check (octet_length(wrapped_workspace_key) >= 384)
);

create index docinspector_workspace_key_envelopes_member_idx
  on public.docinspector_workspace_key_envelopes(member_user_id, workspace_id, key_version);

create table public.docinspector_project_documents (
  id uuid primary key,
  workspace_id uuid not null references public.sky17_workspaces(id) on delete cascade,
  inspection_id uuid not null,
  object_path text not null,
  crypto_version text not null default 'DIPDF1',
  workspace_key_version integer not null,
  wrapped_file_key bytea not null,
  metadata_ciphertext bytea not null,
  metadata_iv bytea not null,
  plaintext_size bigint not null,
  ciphertext_size bigint not null,
  chunk_count integer not null,
  ciphertext_sha256 text,
  status text not null default 'ACTIVE',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint docinspector_project_documents_workspace_key_fk
    foreign key (workspace_id, workspace_key_version)
    references public.docinspector_workspace_crypto_keys(workspace_id, key_version),
  constraint docinspector_project_documents_crypto_version_check check (crypto_version = 'DIPDF1'),
  constraint docinspector_project_documents_path_check check (
    object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.dipdf$'
    and split_part(object_path, '/', 1) = workspace_id::text
    and split_part(object_path, '/', 2) = inspection_id::text
    and split_part(object_path, '/', 3) = id::text || '.dipdf'
  ),
  constraint docinspector_project_documents_plaintext_size_check check (plaintext_size between 1 and 20971520),
  constraint docinspector_project_documents_ciphertext_size_check check (ciphertext_size > plaintext_size and ciphertext_size <= 52428800),
  constraint docinspector_project_documents_chunk_count_check check (chunk_count between 1 and 20),
  constraint docinspector_project_documents_wrapped_file_key_check check (octet_length(wrapped_file_key) > 16),
  constraint docinspector_project_documents_metadata_iv_check check (octet_length(metadata_iv) = 12),
  constraint docinspector_project_documents_metadata_ciphertext_check check (octet_length(metadata_ciphertext) > 16),
  constraint docinspector_project_documents_sha_check check (ciphertext_sha256 is null or ciphertext_sha256 ~ '^[0-9a-f]{64}$'),
  constraint docinspector_project_documents_status_check check (status in ('UPLOADING','ACTIVE','DELETED')),
  constraint docinspector_project_documents_deleted_at_check check (
    (status = 'DELETED' and deleted_at is not null) or (status <> 'DELETED' and deleted_at is null)
  )
);

create unique index docinspector_project_documents_object_path_idx
  on public.docinspector_project_documents(object_path);

create index docinspector_project_documents_inspection_idx
  on public.docinspector_project_documents(workspace_id, inspection_id, created_at)
  where status <> 'DELETED';

alter table public.docinspector_member_public_keys enable row level security;
alter table public.docinspector_member_key_backups enable row level security;
alter table public.docinspector_workspace_crypto_keys enable row level security;
alter table public.docinspector_workspace_key_envelopes enable row level security;
alter table public.docinspector_project_documents enable row level security;

revoke all on table public.docinspector_member_public_keys from anon, authenticated;
revoke all on table public.docinspector_member_key_backups from anon, authenticated;
revoke all on table public.docinspector_workspace_crypto_keys from anon, authenticated;
revoke all on table public.docinspector_workspace_key_envelopes from anon, authenticated;
revoke all on table public.docinspector_project_documents from anon, authenticated;

grant select, insert, update on table public.docinspector_member_public_keys to authenticated;
grant select, insert, update on table public.docinspector_member_key_backups to authenticated;
grant select, insert, update on table public.docinspector_workspace_crypto_keys to authenticated;
grant select, insert, update, delete on table public.docinspector_workspace_key_envelopes to authenticated;
grant select, insert, update, delete on table public.docinspector_project_documents to authenticated;

create policy docinspector_member_public_keys_select_workspace
on public.docinspector_member_public_keys for select to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_public_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_member_public_keys_insert_own
on public.docinspector_member_public_keys for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_public_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_member_public_keys_update_own
on public.docinspector_member_public_keys for update to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_public_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_public_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_member_key_backups_select_own
on public.docinspector_member_key_backups for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_key_backups.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_member_key_backups_insert_own
on public.docinspector_member_key_backups for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_member_key_backups.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_member_key_backups_update_own
on public.docinspector_member_key_backups for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy docinspector_workspace_crypto_keys_select_member
on public.docinspector_workspace_crypto_keys for select to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_crypto_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_workspace_crypto_keys_insert_admin
on public.docinspector_workspace_crypto_keys for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_crypto_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
);

create policy docinspector_workspace_crypto_keys_update_admin
on public.docinspector_workspace_crypto_keys for update to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_crypto_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
)
with check (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_crypto_keys.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role = 'ADMIN'
  )
);

create policy docinspector_workspace_key_envelopes_select_own
on public.docinspector_workspace_key_envelopes for select to authenticated
using (
  member_user_id = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_key_envelopes.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_workspace_key_envelopes_insert_admin
on public.docinspector_workspace_key_envelopes for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members admin_member
    where admin_member.workspace_id = docinspector_workspace_key_envelopes.workspace_id
      and admin_member.user_id = (select auth.uid())
      and admin_member.active
      and admin_member.role = 'ADMIN'
  )
  and exists (
    select 1 from public.docinspector_workspace_members target_member
    where target_member.workspace_id = docinspector_workspace_key_envelopes.workspace_id
      and target_member.user_id = docinspector_workspace_key_envelopes.member_user_id
      and target_member.active
  )
);

create policy docinspector_workspace_key_envelopes_update_admin
on public.docinspector_workspace_key_envelopes for update to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_key_envelopes.workspace_id
      and m.user_id = (select auth.uid())
      and m.active and m.role = 'ADMIN'
  )
)
with check (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_key_envelopes.workspace_id
      and m.user_id = (select auth.uid())
      and m.active and m.role = 'ADMIN'
  )
);

create policy docinspector_workspace_key_envelopes_delete_admin
on public.docinspector_workspace_key_envelopes for delete to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_workspace_key_envelopes.workspace_id
      and m.user_id = (select auth.uid())
      and m.active and m.role = 'ADMIN'
  )
);

create policy docinspector_project_documents_select_member
on public.docinspector_project_documents for select to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_project_documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
  )
);

create policy docinspector_project_documents_insert_writer
on public.docinspector_project_documents for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_project_documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role in ('ADMIN','INSPECTOR')
  )
);

create policy docinspector_project_documents_update_writer
on public.docinspector_project_documents for update to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_project_documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role in ('ADMIN','INSPECTOR')
  )
)
with check (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_project_documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role in ('ADMIN','INSPECTOR')
  )
);

create policy docinspector_project_documents_delete_writer
on public.docinspector_project_documents for delete to authenticated
using (
  exists (
    select 1 from public.docinspector_workspace_members m
    where m.workspace_id = docinspector_project_documents.workspace_id
      and m.user_id = (select auth.uid())
      and m.active
      and m.role in ('ADMIN','INSPECTOR')
  )
);

create trigger docinspector_member_key_backups_touch_updated_at
before update on public.docinspector_member_key_backups
for each row execute function private.docinspector_touch_updated_at();

create trigger docinspector_project_documents_touch_updated_at
before update on public.docinspector_project_documents
for each row execute function private.docinspector_touch_updated_at();
