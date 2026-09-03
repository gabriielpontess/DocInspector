-- Retira metadados e mecanismos relacionais do subsistema de PDF confidencial/E2EE.
-- O bucket Storage precisa estar fisicamente vazio via Storage API antes desta migration ser aplicada.
-- Migrações históricas permanecem no repositório como proveniência.

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'docinspector-confidential-pdfs') then
    raise exception 'docinspector-confidential-pdfs ainda contém objetos; esvazie via Storage API antes da retirada relacional';
  end if;
end $$;

drop policy if exists docinspector_confidential_pdf_delete on storage.objects;
drop policy if exists docinspector_confidential_pdf_insert on storage.objects;
drop policy if exists docinspector_confidential_pdf_select on storage.objects;

delete from storage.buckets where id = 'docinspector-confidential-pdfs'
  and not exists (select 1 from storage.objects where bucket_id = 'docinspector-confidential-pdfs');

drop trigger if exists docinspector_workspace_members_guard_e2ee_deactivation on public.docinspector_workspace_members;

drop function if exists public.docinspector_guard_e2ee_member_deactivation() cascade;
drop function if exists public.docinspector_block_confidential_upload_during_rotation() cascade;
drop function if exists public.docinspector_enforce_confidential_document_limits() cascade;
drop function if exists public.docinspector_begin_member_removal_rotation(uuid, uuid, integer, integer, bytea) cascade;
drop function if exists public.docinspector_crypto_key_targets(uuid) cascade;
drop function if exists public.docinspector_finish_workspace_rotation(uuid, integer, integer) cascade;
drop function if exists public.docinspector_initialize_workspace_crypto(uuid, integer, bytea) cascade;
drop function if exists public.docinspector_rewrap_confidential_file_key(uuid, uuid, integer, integer, bytea) cascade;
drop function if exists public.docinspector_workspace_rotation_status(uuid) cascade;

drop table if exists public.docinspector_project_documents cascade;
drop table if exists public.docinspector_workspace_key_envelopes cascade;
drop table if exists public.docinspector_workspace_crypto_keys cascade;
drop table if exists public.docinspector_member_key_backups cascade;
drop table if exists public.docinspector_member_public_keys cascade;
drop table if exists public.docinspector_confidential_pdf_config cascade;
