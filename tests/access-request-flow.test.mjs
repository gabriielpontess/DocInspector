import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260819230500_add_workspace_access_requests.sql', import.meta.url), 'utf8');
const publicEdge = fs.readFileSync(new URL('../supabase/functions/docinspector-access-request/index.ts', import.meta.url), 'utf8');
const adminEdge = fs.readFileSync(new URL('../supabase/functions/docinspector-user-admin/index.ts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../js/access-request.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../js/auth-entry.js', import.meta.url), 'utf8');
const adminUi = fs.readFileSync(new URL('../js/access-request-admin-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../auth.css', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(migration, /create table public\.docinspector_workspace_access_codes/);
assert.match(migration, /create table public\.docinspector_access_requests/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.docinspector_access_requests from public, anon, authenticated/);
assert.match(migration, /where status = 'PENDING'/, 'apenas uma solicitação pendente por e-mail/workspace deve existir');
assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete).*docinspector_access_requests.*anon/i);

assert.match(publicEdge, /docinspector_workspace_access_codes/);
assert.match(publicEdge, /docinspector_access_requests/);
assert.match(publicEdge, /NETLIFY_PREVIEW/);
assert.match(publicEdge, /https:\/\/docinspector\.netlify\.app/);
assert.match(publicEdge, /https:\/\/app\.docinspector\.com\.br/);
assert.match(publicEdge, /elapsedMs < 800/);
assert.match(publicEdge, /if \(website\) return json\(202/);
assert.match(publicEdge, /count \|\| 0\) >= 3/);
assert.doesNotMatch(publicEdge, /createUser|inviteUserByEmail|signUp/, 'endpoint público nunca deve criar usuário');

assert.match(client, /functions\/v1\/docinspector-access-request/);
assert.match(client, /AUTH_CONFIG\.publishableKey/);
assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_/i);
assert.match(entry, /Solicitar cadastro/);
assert.match(entry, /id="access-request-form"/);
assert.match(entry, /submitAccessRequest/);
assert.match(entry, /import\('\.\/access-request-admin-ui\.js'\)/);
assert.match(entry, /Nenhuma conta ou permissão é criada automaticamente/);

const membershipGuard = adminEdge.indexOf("callerMembership.role !== 'ADMIN'");
const requestActions = adminEdge.indexOf("action === 'access-request-code'");
assert.ok(membershipGuard >= 0 && requestActions > membershipGuard, 'ações de solicitação devem ficar depois da validação ADMIN');
assert.match(adminEdge, /action === 'access-requests'/);
assert.match(adminEdge, /action === 'resolve-access-request'/);
assert.match(adminEdge, /ensureUserAccess/);
assert.match(adminEdge, /status = decision === 'APPROVE' \? 'APPROVED' : 'REJECTED'/);

assert.match(adminUi, /CAPABILITY\.MANAGE_USERS/);
assert.match(adminUi, /Aprovar e convidar/);
assert.match(adminUi, /data-request-reject/);
assert.match(adminUi, /data-copy-request-code/);
assert.match(css, /user-admin-access-request/);
assert.match(css, /auth-honeypot/);
assert.match(css, /@media \(max-width: 600px\)/);

assert.match(sw, /const VERSION = '0\.9\.38';/);
assert.match(sw, /\.\/js\/access-request\.js/);
assert.match(sw, /\.\/js\/access-request-admin-ui\.js/);

console.log('Access request flow checks passed.');
