revoke execute on function public.sky17_schema_version() from authenticated;
revoke execute on function public.sky17_create_workspace(uuid, text, text) from authenticated;
revoke execute on function public.sky17_verify_workspace(uuid, text) from authenticated;
revoke execute on function public.sky17_pull_inspections(uuid, text) from authenticated;
revoke execute on function public.sky17_pull_deletions(uuid, text) from authenticated;
revoke execute on function public.sky17_upsert_inspection(uuid, text, uuid, jsonb, text) from authenticated;
revoke execute on function public.sky17_delete_inspection(uuid, text, uuid, text) from authenticated;
revoke execute on function public.sky17_storage_object_allowed(text) from authenticated;

drop policy if exists docinspector_evidence_select on storage.objects;
create policy docinspector_evidence_select on storage.objects for select to anon
using (bucket_id='docinspector-evidence' and public.sky17_storage_object_allowed(name));

drop policy if exists docinspector_evidence_insert on storage.objects;
create policy docinspector_evidence_insert on storage.objects for insert to anon
with check (bucket_id='docinspector-evidence' and public.sky17_storage_object_allowed(name));

drop policy if exists docinspector_evidence_update on storage.objects;
create policy docinspector_evidence_update on storage.objects for update to anon
using (bucket_id='docinspector-evidence' and public.sky17_storage_object_allowed(name))
with check (bucket_id='docinspector-evidence' and public.sky17_storage_object_allowed(name));

drop policy if exists docinspector_evidence_delete on storage.objects;
create policy docinspector_evidence_delete on storage.objects for delete to anon
using (bucket_id='docinspector-evidence' and public.sky17_storage_object_allowed(name));