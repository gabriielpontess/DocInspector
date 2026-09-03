# Settings, admin-only access and request repair

This release simplifies the Dados e backup screen, retires non-Administrator workspace profiles and closes the production drift that caused the Solicitações panel to call unsupported backend actions.

## UI

- The large PWA installation card is removed. A compact install action is shown only when the browser can actually act on installation.
- Backup and restore share one card and keep their existing event handlers.
- The obsolete local-data warning card is removed.
- Administrator controls use a fixed-size checkbox so `Ativo` cannot collapse or overflow.
- Invite, membership and access-request approval flows expose only `Administrador`.

## Backend

The repository already contained the access-request schema migration and public request function, but production had not applied/deployed them. Release promotion must apply that schema before deploying the current `docinspector-user-admin` and `docinspector-access-request` functions.

A forward migration normalizes any legacy membership to `ADMIN` before replacing the role check with `role = 'ADMIN'`. Historical migrations remain unchanged as provenance.

## Validation

Promotion requires deterministic checks, Chromium + WebKit browser execution, inspection of Playwright logs/artifacts, backend schema verification and a green Netlify Deploy Preview on the exact release HEAD.
