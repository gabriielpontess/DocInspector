import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync(new URL('../supabase/functions/docinspector-user-admin/index.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../js/user-admin-ui.js', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../js/permissions.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../js/auth-entry.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/, 'credential elevated must exist only server-side');
assert.match(edge, /admin\.auth\.getUser\(token\)/, 'caller JWT must be validated against Supabase Auth');
assert.match(edge, /callerMembership\.role !== 'ADMIN'/, 'server must require ADMIN membership');
assert.match(edge, /inviteUserByEmail/, 'new accounts must be invited server-side');
assert.match(edge, /docinspector_workspace_members/, 'membership must be persisted server-side');
assert.match(edge, /O último Administrador ativo não pode ser desativado ou rebaixado/, 'last active admin must be protected');
assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_/i, 'browser admin UI cannot contain privileged credentials');
assert.match(ui, /functions\.invoke\('docinspector-user-admin'/, 'browser must call the protected Edge Function');
assert.match(ui, /CAPABILITY\.MANAGE_USERS/, 'admin UI must be capability gated');
assert.match(permissions, /capability !== CAPABILITY\.MANAGE_USERS/, 'Inspector must exclude user management capability');
assert.match(entry, /import\('\.\/user-admin-ui\.js'\)/, 'authenticated bootstrap must load admin UI module');
assert.match(sw, /\.\/js\/user-admin-ui\.js/, 'Gate E module must remain available in the PWA shell');
assert.match(sw, /const VERSION = '0\.9\.29';/, 'Gate E must advance technical cache identity');

console.log('Auth/RBAC Gate E administration checks passed.');
