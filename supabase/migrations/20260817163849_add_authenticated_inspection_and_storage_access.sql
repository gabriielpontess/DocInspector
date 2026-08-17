grant select, insert, update, delete on table public.sky17_inspections to authenticated;
grant select, insert, update, delete on table public.sky17_deletions to authenticated;

drop policy if exists docinspector_inspections_select_member on public.sky17_inspections;
create policy docinspector_inspections_select_member
on public.sky17_inspections for select to authenticated
using (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_inspections.workspace_id and m.user_id = (select auth.uid()) and m.active));

drop policy if exists docinspector_inspections_insert_writer on public.sky17_inspections;
create policy docinspector_inspections_insert_writer
on public.sky17_inspections for insert to authenticated
with check (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_inspections.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

drop policy if exists docinspector_inspections_update_writer on public.sky17_inspections;
create policy docinspector_inspections_update_writer
on public.sky17_inspections for update to authenticated
using (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_inspections.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')))
with check (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_inspections.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

drop policy if exists docinspector_inspections_delete_writer on public.sky17_inspections;
create policy docinspector_inspections_delete_writer
on public.sky17_inspections for delete to authenticated
using (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_inspections.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

drop policy if exists docinspector_deletions_select_member on public.sky17_deletions;
create policy docinspector_deletions_select_member
on public.sky17_deletions for select to authenticated
using (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_deletions.workspace_id and m.user_id = (select auth.uid()) and m.active));

drop policy if exists docinspector_deletions_insert_writer on public.sky17_deletions;
create policy docinspector_deletions_insert_writer
on public.sky17_deletions for insert to authenticated
with check (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_deletions.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

drop policy if exists docinspector_deletions_update_writer on public.sky17_deletions;
create policy docinspector_deletions_update_writer
on public.sky17_deletions for update to authenticated
using (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_deletions.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')))
with check (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_deletions.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

drop policy if exists docinspector_deletions_delete_writer on public.sky17_deletions;
create policy docinspector_deletions_delete_writer
on public.sky17_deletions for delete to authenticated
using (exists (select 1 from public.docinspector_workspace_members m where m.workspace_id = sky17_deletions.workspace_id and m.user_id = (select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

create or replace function public.docinspector_pull_inspections(p_workspace_id uuid)
returns table (id uuid, payload jsonb, updated_at timestamptz, device_id text)
language sql stable security invoker set search_path = ''
as $$ select i.id, i.payload, i.updated_at, i.device_id from public.sky17_inspections i where i.workspace_id = p_workspace_id order by i.updated_at asc; $$;
revoke all on function public.docinspector_pull_inspections(uuid) from public, anon;
grant execute on function public.docinspector_pull_inspections(uuid) to authenticated;

create or replace function public.docinspector_pull_deletions(p_workspace_id uuid)
returns table (inspection_id uuid, deleted_at timestamptz, device_id text)
language sql stable security invoker set search_path = ''
as $$ select d.inspection_id, d.deleted_at, d.device_id from public.sky17_deletions d where d.workspace_id = p_workspace_id order by d.deleted_at asc; $$;
revoke all on function public.docinspector_pull_deletions(uuid) from public, anon;
grant execute on function public.docinspector_pull_deletions(uuid) to authenticated;

create or replace function public.docinspector_upsert_inspection(p_workspace_id uuid, p_inspection_id uuid, p_payload jsonb, p_device_id text default null)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'autenticação obrigatória'; end if;
  if not exists (select 1 from public.docinspector_workspace_members m where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')) then raise exception 'perfil sem permissão de escrita neste workspace'; end if;
  if p_inspection_id is null or p_payload is null then raise exception 'inspeção inválida'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'payload da inspeção deve ser um objeto JSON'; end if;
  if pg_column_size(p_payload) > 12582912 then raise exception 'payload da inspeção excede o limite de 12 MB'; end if;
  if jsonb_typeof(p_payload->'documents') <> 'array' then raise exception 'payload da inspeção sem lista de documentos válida'; end if;
  if jsonb_array_length(p_payload->'documents') > 50000 then raise exception 'a inspeção excede o limite de 50.000 documentos'; end if;
  if coalesce(p_payload->>'id','') <> p_inspection_id::text then raise exception 'o id do payload não corresponde ao id da inspeção'; end if;
  if exists (select 1 from public.sky17_deletions d where d.workspace_id=p_workspace_id and d.inspection_id=p_inspection_id) then raise exception 'esta inspeção foi excluída neste espaço'; end if;
  insert into public.sky17_inspections (id,workspace_id,payload,device_id,updated_at) values (p_inspection_id,p_workspace_id,p_payload,left(coalesce(p_device_id,''),120),now())
  on conflict (workspace_id,id) do update set payload=excluded.payload, device_id=excluded.device_id, updated_at=now() where public.sky17_inspections.workspace_id=p_workspace_id;
  return true;
end; $$;
revoke all on function public.docinspector_upsert_inspection(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.docinspector_upsert_inspection(uuid, uuid, jsonb, text) to authenticated;

create or replace function public.docinspector_delete_inspection(p_workspace_id uuid, p_inspection_id uuid, p_device_id text default null)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'autenticação obrigatória'; end if;
  if not exists (select 1 from public.docinspector_workspace_members m where m.workspace_id=p_workspace_id and m.user_id=(select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')) then raise exception 'perfil sem permissão de exclusão neste workspace'; end if;
  if p_inspection_id is null then raise exception 'inspection_id obrigatório'; end if;
  insert into public.sky17_deletions (workspace_id,inspection_id,device_id,deleted_at) values (p_workspace_id,p_inspection_id,left(coalesce(p_device_id,''),120),now())
  on conflict (workspace_id,inspection_id) do update set device_id=excluded.device_id, deleted_at=greatest(public.sky17_deletions.deleted_at,excluded.deleted_at);
  delete from public.sky17_inspections where workspace_id=p_workspace_id and id=p_inspection_id;
  return true;
end; $$;
revoke all on function public.docinspector_delete_inspection(uuid, uuid, text) from public, anon;
grant execute on function public.docinspector_delete_inspection(uuid, uuid, text) to authenticated;

drop policy if exists docinspector_evidence_authenticated_select on storage.objects;
create policy docinspector_evidence_authenticated_select on storage.objects for select to authenticated
using (bucket_id='docinspector-evidence' and exists (select 1 from public.docinspector_workspace_members m where m.workspace_id::text=split_part(storage.objects.name,'/',1) and m.user_id=(select auth.uid()) and m.active));

drop policy if exists docinspector_evidence_authenticated_insert on storage.objects;
create policy docinspector_evidence_authenticated_insert on storage.objects for insert to authenticated
with check (bucket_id='docinspector-evidence' and exists (select 1 from public.docinspector_workspace_members m where m.workspace_id::text=split_part(storage.objects.name,'/',1) and m.user_id=(select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

drop policy if exists docinspector_evidence_authenticated_update on storage.objects;
create policy docinspector_evidence_authenticated_update on storage.objects for update to authenticated
using (bucket_id='docinspector-evidence' and exists (select 1 from public.docinspector_workspace_members m where m.workspace_id::text=split_part(storage.objects.name,'/',1) and m.user_id=(select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')))
with check (bucket_id='docinspector-evidence' and exists (select 1 from public.docinspector_workspace_members m where m.workspace_id::text=split_part(storage.objects.name,'/',1) and m.user_id=(select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));

drop policy if exists docinspector_evidence_authenticated_delete on storage.objects;
create policy docinspector_evidence_authenticated_delete on storage.objects for delete to authenticated
using (bucket_id='docinspector-evidence' and exists (select 1 from public.docinspector_workspace_members m where m.workspace_id::text=split_part(storage.objects.name,'/',1) and m.user_id=(select auth.uid()) and m.active and m.role in ('ADMIN','INSPECTOR')));