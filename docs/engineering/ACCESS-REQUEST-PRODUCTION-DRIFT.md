# Access-request production drift

Observed production state before this release:

- the frontend called `access-request-code` and `access-requests`;
- deployed `docinspector-user-admin` was still version 1 and only implemented `list`, `invite` and `update`;
- `docinspector_workspace_access_codes` and `docinspector_access_requests` were absent from production;
- `docinspector-access-request` was not deployed;
- Edge Function logs showed one successful member-list request followed by two HTTP 400 responses on each admin-panel load.

The resulting generic client error was `Edge Function returned a non-2xx status code` twice.

Release order is schema first, Edge Functions second, frontend promotion last. This avoids exposing a frontend or backend action before its database contract exists.
