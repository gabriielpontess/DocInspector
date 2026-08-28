import assert from 'node:assert/strict';
import { CAPABILITY, ROLE, can } from '../js/permissions.js';

assert.equal(can(ROLE.ADMIN, CAPABILITY.MANAGE_DOCUMENTS), true);
assert.equal(can(ROLE.INSPECTOR, CAPABILITY.MANAGE_DOCUMENTS), true);
assert.equal(can(ROLE.SUPERVISOR, CAPABILITY.MANAGE_DOCUMENTS), false);
assert.equal(can(ROLE.FOREMAN, CAPABILITY.MANAGE_DOCUMENTS), false);

console.log('engineering-tracker-permissions.test.mjs: OK');
