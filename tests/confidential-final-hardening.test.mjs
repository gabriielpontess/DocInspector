import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260820222500_guard_confidential_member_deactivation.sql';
const migration = await readFile(migrationPath, 'utf8');
const userAdminUi = await readFile('js/user-admin-ui.js', 'utf8');
const permissionUi = await readFile('js/permission-ui.js', 'utf8');

assert.match(migration, /private\.docinspector_guard_e2ee_member_deactivation/);
assert.match(migration, /before update of active on public\.docinspector_workspace_members/i);
assert.match(migration, /old\.active\s+and\s+not new\.active/i);
assert.match(migration, /docinspector_workspace_crypto_keys/);
assert.match(migration, /current_setting\('docinspector\.e2ee_member_removal', true\)/);
assert.match(migration, /pg_catalog\.set_config\(\s*'docinspector\.e2ee_member_removal'/);
assert.match(migration, /p_workspace_id::text \|\| ':' \|\| p_removed_user_id::text/);
assert.match(migration, /update public\.docinspector_workspace_members\s+set active = false/i);
assert.match(migration, /set_config\('docinspector\.e2ee_member_removal', '', true\)/);
assert.match(migration, /security invoker/i);
assert.match(migration, /revoke all on function private\.docinspector_guard_e2ee_member_deactivation\(\)/i);
assert.match(migration, /security definer/i);
assert.match(migration, /m\.role = 'ADMIN'/);
assert.match(migration, /m\.active/);

assert.match(userAdminUi, /removeMemberAndRotateWorkspaceKey/);
assert.match(userAdminUi, /wasActive\s*&&\s*!active/);
assert.match(userAdminUi, /if \(!removed\) return \{ changed: false, removed: false \};\s*return \{ changed: true, removed: true \};/s,
  'secure removal branch must return before generic membership update');

assert.match(permissionUi, /clearLocalConfidentialKeys\(\)/);
assert.match(permissionUi, /clearAllConfidentialCiphertext\(\)/);
assert.match(permissionUi, /clearCachedWorkspaceEnvelopes\(\)/);
assert.match(permissionUi, /Promise\.allSettled/);

console.log('Confidential E2EE final hardening regression checks passed.');
