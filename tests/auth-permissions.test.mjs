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

assert.equal(authRolloutEnabled(), true, 'Auth must remain enabled.');
assert.match(AUTH_CONFIG.projectUrl, /^https:\/\/[a-z0-9-]+\.supabase\.co$/);
assert.match(AUTH_CONFIG.publishableKey, /^sb_publishable_/);
assert.equal(AUTH_CONFIG.publishableKey.includes('secret'), false);

assert.deepEqual(Object.keys(ROLE), ['ADMIN'], 'Administrador deve ser o único perfil exposto pelo produto');
assert.equal(normalizeRole(' admin '), ROLE.ADMIN);
for (const retired of ['INSPECTOR', 'SUPERVISOR', 'FOREMAN', 'unknown']) {
  assert.equal(normalizeRole(retired), null, `${retired} não pode permanecer como perfil aceito`);
}
assert.equal(roleLabel(ROLE.ADMIN), 'Administrador');
assert.equal(roleLabel('unknown'), 'Sem perfil');

for (const capability of Object.values(CAPABILITY)) {
  assert.equal(can(ROLE.ADMIN, capability), true, `ADMIN deve possuir ${capability}`);
}
assert.deepEqual(capabilitiesForRole('INSPECTOR'), []);
assert.equal(can('INSPECTOR', CAPABILITY.VIEW_DOCUMENTS), false);
assert.equal(can(null, CAPABILITY.VIEW_DOCUMENTS), false);
assert.equal(can(ROLE.ADMIN, 'UNKNOWN_CAPABILITY'), false);
assert.equal(canAny(ROLE.ADMIN, [CAPABILITY.MANAGE_DOCUMENTS, CAPABILITY.COMMENT_DOCUMENTS]), true);
assert.equal(canAll(ROLE.ADMIN, [CAPABILITY.VIEW_DOCUMENTS, CAPABILITY.MANAGE_USERS]), true);

console.log('Administrator-only permission model approved.');
