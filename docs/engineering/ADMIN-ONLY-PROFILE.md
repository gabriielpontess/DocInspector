# Administrator-only workspace profile

DocInspector now exposes one workspace profile: `ADMIN` (`Administrador`). Invite, member update and access-request approval flows no longer allow selecting Inspector, Supervisor or Foreman.

The database cutover normalizes any legacy membership to `ADMIN` before tightening `docinspector_workspace_members_role_check` to `role = 'ADMIN'`. Historical migrations retain the earlier role values only as migration provenance.
