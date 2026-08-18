-- APPLY ONLY AFTER authenticated field validation is complete.
-- This file intentionally lives outside supabase/migrations so it cannot be applied by normal migration rollout.

begin;

revoke execute on function public.sky17_create_workspace(uuid, text, text) from anon;
revoke execute on function public.sky17_verify_workspace(uuid, text) from anon;
revoke execute on function public.sky17_pull_inspections(uuid, text) from anon;
revoke execute on function public.sky17_pull_deletions(uuid, text) from anon;
revoke execute on function public.sky17_upsert_inspection(uuid, text, uuid, jsonb, text) from anon;
revoke execute on function public.sky17_delete_inspection(uuid, text, uuid, text) from anon;
revoke execute on function public.sky17_schema_version() from anon;
revoke execute on function public.sky17_storage_object_allowed(text) from anon;

drop policy if exists docinspector_evidence_select on storage.objects;
drop policy if exists docinspector_evidence_insert on storage.objects;
drop policy if exists docinspector_evidence_update on storage.objects;
drop policy if exists docinspector_evidence_delete on storage.objects;

commit;
