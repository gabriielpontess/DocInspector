import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminEdge = fs.readFileSync(new URL('../supabase/functions/docinspector-user-admin/index.ts', import.meta.url), 'utf8');
const publicEdge = fs.readFileSync(new URL('../supabase/functions/docinspector-access-request/index.ts', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');

for (const action of ['access-request-code', 'access-requests', 'resolve-access-request', 'list', 'invite', 'update']) {
  assert.match(adminEdge, new RegExp(`action === '${action}'`), `admin edge must implement ${action}`);
}
assert.match(adminEdge, /const ADMIN_ROLE = 'ADMIN'/);
assert.doesNotMatch(adminEdge, /INSPECTOR|SUPERVISOR|FOREMAN/);
assert.match(publicEdge, /docinspector_access_requests/);
assert.match(config, /\[functions\.docinspector-access-request\][\s\S]*verify_jwt\s*=\s*false/);
assert.match(config, /\[functions\.docinspector-user-admin\][\s\S]*verify_jwt\s*=\s*true/);

console.log('Access-request backend drift contracts passed.');
