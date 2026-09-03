import assert from 'node:assert/strict';
import fs from 'node:fs';

const access = fs.readFileSync(new URL('../supabase/migrations/20260819230500_add_workspace_access_requests.sql', import.meta.url), 'utf8');
const adminOnly = fs.readFileSync(new URL('../supabase/migrations/20260903174000_enforce_admin_only_memberships.sql', import.meta.url), 'utf8');

assert.match(access, /docinspector_workspace_access_codes/);
assert.match(access, /docinspector_access_requests/);
assert.match(adminOnly, /check \(role = 'ADMIN'\)/i);

console.log('Access request/admin-only migrations are present.');
