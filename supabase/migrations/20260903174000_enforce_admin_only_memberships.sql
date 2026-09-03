-- The product now exposes a single workspace profile: ADMIN.
-- Historical migrations keep the former RBAC values as provenance; this forward migration
-- normalizes any legacy membership before tightening the database contract.
update public.docinspector_workspace_members
set role = 'ADMIN'
where role <> 'ADMIN';

alter table public.docinspector_workspace_members
  drop constraint if exists docinspector_workspace_members_role_check;

alter table public.docinspector_workspace_members
  add constraint docinspector_workspace_members_role_check
  check (role = 'ADMIN');
