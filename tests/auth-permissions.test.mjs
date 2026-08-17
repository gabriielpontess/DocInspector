import assert from 'node:assert/strict';
import {
  CAPABILITY,
  ROLE,
  can,
  canAll,
  canAny,
  capabilitiesForRole,
  normalizeRole,
  roleLabel
} from '../js/permissions.js';
import { AUTH_CONFIG, authRolloutEnabled } from '../js/auth-config.js';

assert.equal(authRolloutEnabled(), false, 'Auth must remain disabled until the server migration is explicitly activated.');
assert.match(AUTH_CONFIG.projectUrl, /^https:\/\/[a-z0-9-]+\.supabase\.co$/);
assert.match(AUTH_CONFIG.publishableKey, /^sb_publishable_/);
assert.equal(AUTH_CONFIG.publishableKey.includes('secret'), false);

assert.equal(normalizeRole(' admin '), ROLE.ADMIN);
assert.equal(normalizeRole('inspector'), ROLE.INSPECTOR);
assert.equal(normalizeRole('supervisor'), ROLE.SUPERVISOR);
assert.equal(normalizeRole('foreman'), ROLE.FOREMAN);
assert.equal(normalizeRole('unknown'), null);
assert.equal(roleLabel(ROLE.FOREMAN), 'Encarregado');
assert.equal(roleLabel('unknown'), 'Sem perfil');

for (const capability of Object.values(CAPABILITY)) {
  assert.equal(can(ROLE.ADMIN, capability), true, `ADMIN should have ${capability}`);
}
for (const capability of Object.values(CAPABILITY).filter(item => item !== CAPABILITY.MANAGE_USERS)) {
  assert.equal(can(ROLE.INSPECTOR, capability), true, `INSPECTOR should have ${capability}`);
}
assert.equal(can(ROLE.INSPECTOR, CAPABILITY.MANAGE_USERS), false, 'Only ADMIN can manage users.');

for (const role of [ROLE.SUPERVISOR, ROLE.FOREMAN]) {
  assert.deepEqual(
    capabilitiesForRole(role).sort(),
    [CAPABILITY.COMMENT_DOCUMENTS, CAPABILITY.VIEW_DOCUMENTS].sort()
  );
  assert.equal(can(role, CAPABILITY.VIEW_DOCUMENTS), true);
  assert.equal(can(role, CAPABILITY.COMMENT_DOCUMENTS), true);
  assert.equal(can(role, CAPABILITY.VERIFY_DOCUMENTS), false);
  assert.equal(can(role, CAPABILITY.MANAGE_DOCUMENTS), false);
  assert.equal(can(role, CAPABILITY.MANAGE_INSPECTIONS), false);
  assert.equal(can(role, CAPABILITY.MANAGE_USERS), false);
}

assert.equal(can(null, CAPABILITY.VIEW_DOCUMENTS), false);
assert.equal(can(ROLE.ADMIN, 'UNKNOWN_CAPABILITY'), false);
assert.equal(canAny(ROLE.SUPERVISOR, [CAPABILITY.MANAGE_DOCUMENTS, CAPABILITY.COMMENT_DOCUMENTS]), true);
assert.equal(canAll(ROLE.SUPERVISOR, [CAPABILITY.VIEW_DOCUMENTS, CAPABILITY.COMMENT_DOCUMENTS]), true);
assert.equal(canAll(ROLE.SUPERVISOR, [CAPABILITY.VIEW_DOCUMENTS, CAPABILITY.VERIFY_DOCUMENTS]), false);

console.log('Auth/RBAC permission model approved.');
