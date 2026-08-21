import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260819230500_add_workspace_access_requests.sql', import.meta.url), 'utf8');
const supabaseConfig = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
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
assert.match(migration, /processing_token uuid/);
assert.match(migration, /processing_started_at timestamptz/);
assert.match(migration, /status in \('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED'\)/);
assert.match(migration, /where status in \('PENDING', 'PROCESSING'\)/, 'deve existir no máximo uma solicitação ativa por e-mail/workspace');
assert.match(migration, /after insert on public\.sky17_workspaces/);
assert.match(migration, /private\.docinspector_seed_workspace_access_code/);
assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete).*docinspector_access_requests.*anon/i);

assert.match(supabaseConfig, /\[functions\.docinspector-access-request\]\s*verify_jwt\s*=\s*false/);
assert.match(supabaseConfig, /\[functions\.docinspector-user-admin\]\s*verify_jwt\s*=\s*true/);

assert.match(publicEdge, /docinspector_workspace_access_codes/);
assert.match(publicEdge, /docinspector_access_requests/);
assert.match(publicEdge, /NETLIFY_PREVIEW/);
assert.match(publicEdge, /https:\/\/docinspector\.netlify\.app/);
assert.match(publicEdge, /https:\/\/app\.docinspector\.com\.br/);
assert.match(publicEdge, /elapsedMs < 800/);
assert.match(publicEdge, /if \(website\) return json\(202/);
assert.match(publicEdge, /count \|\| 0\) >= 3/);
assert.match(publicEdge, /\.in\('status', \['PENDING', 'PROCESSING'\]\)/, 'pedido em processamento deve impedir duplicata concorrente');
assert.match(publicEdge, /insertError\?\.code === '23505'/, 'colisão concorrente deve ser tratada como submissão idempotente');
assert.doesNotMatch(publicEdge, /createUser|inviteUserByEmail|signUp/, 'endpoint público nunca deve criar usuário');

assert.match(client, /functions\/v1\/docinspector-access-request/);
assert.match(client, /AUTH_CONFIG\.publishableKey/);
assert.match(client, /Não foi possível conectar ao serviço de solicitação/);
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
assert.match(adminEdge, /ensureWorkspaceAccessCode/);
assert.match(adminEdge, /ACCESS_REQUEST_PROCESSING_TTL_MS/);
assert.match(adminEdge, /requeueStaleAccessRequests/);
assert.match(adminEdge, /releaseAccessRequestClaim/);
assert.match(adminEdge, /processing_token/);
assert.match(adminEdge, /status: 'PROCESSING'/);
assert.match(adminEdge, /ensureUserAccess/);

const resolveAction = adminEdge.indexOf("action === 'resolve-access-request'");
const claimCall = adminEdge.indexOf('const claim = await claimAccessRequest', resolveAction);
const provisionCall = adminEdge.indexOf('accessResult = await ensureUserAccess', claimCall);
const finalizeCall = adminEdge.indexOf('await finalizeAccessRequest', provisionCall);
assert.ok(
  resolveAction >= 0 && claimCall > resolveAction && provisionCall > claimCall && finalizeCall > provisionCall,
  'claim atômico deve ocorrer antes de qualquer provisionamento e finalização'
);
assert.match(adminEdge, /refreshedUsers = await listAllUsers/, 'convite concorrente deve revalidar usuário antes de falhar');

assert.match(adminUi, /CAPABILITY\.MANAGE_USERS/);
assert.match(adminUi, /Aprovar e convidar/);
assert.match(adminUi, /data-request-reject/);
assert.match(adminUi, /data-copy-request-code/);
assert.match(css, /user-admin-access-request/);
assert.match(css, /auth-honeypot/);
assert.match(css, /@media \(max-width: 600px\)/);

assert.match(sw, /const VERSION = '0\.9\.41';/);
assert.match(sw, /\.\/js\/access-request\.js/);
assert.match(sw, /\.\/js\/access-request-admin-ui\.js/);

console.log('Access request flow checks passed.');
