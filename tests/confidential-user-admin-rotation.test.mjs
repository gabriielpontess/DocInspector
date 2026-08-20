import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('js/user-admin-ui.js', 'utf8');

assert.match(source, /import\('\.\/confidential-rotation\.js'\)/, 'rotation runtime must be loaded lazily');
assert.match(source, /removeMemberAndRotateWorkspaceKey/);
assert.match(source, /resumeWorkspaceKeyRotation/);
assert.match(source, /getWorkspaceRotationStatus/);
assert.match(source, /data-member-active-original/);
assert.match(source, /data-member-role-original/);
assert.match(source, /Use outro Administrador para remover sua própria conta/);
assert.match(source, /Salve a alteração de perfil separadamente antes de remover o membro/);
assert.match(source, /Workspace Key rotacionada com segurança/);

const secureStart = source.indexOf('async function saveMemberChange');
const secureEnd = source.indexOf('async function resumePendingRotation');
assert.ok(secureStart >= 0 && secureEnd > secureStart, 'saveMemberChange boundary must exist');
const saveFlow = source.slice(secureStart, secureEnd);
const deactivateBranch = saveFlow.indexOf('if (wasActive && !active)');
const secureRemoval = saveFlow.indexOf('removeMemberSecurely');
const genericUpdate = saveFlow.indexOf("invokeAdmin({ action: 'update'");
assert.ok(deactivateBranch >= 0, 'active -> inactive transition must be explicit');
assert.ok(secureRemoval > deactivateBranch, 'deactivation must enter the secure rotation path');
assert.ok(genericUpdate > secureRemoval, 'generic admin update must only run after the deactivation branch returns');
assert.doesNotMatch(saveFlow.slice(deactivateBranch, genericUpdate), /invokeAdmin\(\{ action: 'update'/, 'deactivation branch must never call the generic membership updater');

assert.match(source, /rotation\?\.status === 'ROTATING'/);
assert.match(source, /data-resume-rotation/);
assert.doesNotMatch(source, /service[_-]?role/i);

console.log('Confidential user-admin rotation integration checks passed.');
