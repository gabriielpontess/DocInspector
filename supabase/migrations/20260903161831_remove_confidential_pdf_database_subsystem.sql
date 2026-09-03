-- Final database retirement of the confidential PDF / E2EE subsystem.
--
-- IMPORTANT: Supabase Storage object bytes are not deleted by this migration.
-- Supabase requires object deletion through the Storage API; deleting rows from
-- storage.objects with SQL would orphan the underlying files. This migration
-- removes the client-facing Storage policies, the E2EE guard/rotation surface,
-- and all application database metadata/keys for the retired subsystem.

-- Remove the E2EE-only member deactivation guard so normal administration is
-- no longer coupled to workspace-key rotation after the feature retirement.
drop trigger if exists docinspector_workspace_members_guard_e2ee_deactivation
  on public.docinspector_workspace_members;

-- Close all client access to the retired Storage bucket. A service-role / owner
-- Storage API operation can still empty and delete the bucket afterward.
drop policy if exists docinspector_confidential_pdf_delete on storage.objects;
drop policy if exists docinspector_confidential_pdf_insert on storage.objects;
drop policy if exists docinspector_confidential_pdf_select on storage.objects;

-- Remove public RPCs before their backing tables disappear.
drop function if exists public.docinspector_begin_member_removal_rotation(
  uuid, uuid, integer, integer, bytea
);
drop function if exists public.docinspector_crypto_key_targets(uuid);
drop function if exists public.docinspector_finish_workspace_rotation(
  uuid, integer, integer
);
drop function if exists public.docinspector_initialize_workspace_crypto(
  uuid, integer, bytea
);
drop function if exists public.docinspector_rewrap_confidential_file_key(
  uuid, uuid, integer, integer, bytea
);
drop function if exists public.docinspector_workspace_rotation_status(uuid);

-- Drop data in foreign-key-safe order. This intentionally destroys the retired
-- encrypted metadata, wrapped keys, key backups and PDF linkage records.
drop table if exists private.docinspector_workspace_key_rotations;
drop table if exists public.docinspector_project_documents;
drop table if exists public.docinspector_workspace_key_envelopes;
drop table if exists public.docinspector_member_key_backups;
drop table if exists public.docinspector_member_public_keys;
drop table if exists public.docinspector_workspace_crypto_keys;
drop table if exists public.docinspector_confidential_pdf_config;

-- Trigger helpers are removable after docinspector_project_documents is gone.
drop function if exists private.docinspector_block_confidential_upload_during_rotation();
drop function if exists private.docinspector_enforce_confidential_document_limits();
drop function if exists private.docinspector_guard_e2ee_member_deactivation();
