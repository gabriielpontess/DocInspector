import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('js/confidential-e2ee-ui.js', 'utf8');
const permissionUi = await readFile('js/permission-ui.js', 'utf8');
const permissions = await readFile('js/permissions.js', 'utf8');

for (const symbol of [
  'enrollConfidentialMember',
  'recoverConfidentialMemberKey',
  'unwrapConfidentialWorkspaceKeyBytes',
  'grantWorkspaceKeyToMember',
  'uploadConfidentialPdf',
  'listConfidentialDocuments',
  'deleteConfidentialDocument',
  'resolveConfidentialCiphertext',
  'openConfidentialPdfForViewer',
  'unlockConfidentialWorkspaceKey'
]) assert.match(source, new RegExp(symbol));

assert.match(source, /CAPABILITY\.MANAGE_PROJECT_FILES/);
assert.match(source, /CAPABILITY\.VIEW_DOCUMENTS/);
assert.match(source, /Recovery Secret/);
assert.match(source, /recoverySecret/);
assert.match(source, /\.fill\(0\)/);
assert.match(source, /application\/pdf/);
assert.match(source, /DIPDF1/);
assert.match(source, /MutationObserver/);
assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*(recovery|secret|plaintext|workspace.?key)/i);
assert.doesNotMatch(source, /sessionStorage\.setItem\([^\n]*(recovery|secret|plaintext|workspace.?key)/i);
assert.doesNotMatch(source, /service[_-]?role/i);

assert.match(permissionUi, /mount as mountConfidentialE2eeUi/);
assert.match(permissionUi, /mountConfidentialE2eeUi\(\)/);
assert.match(permissionUi, /catalog\.before\(card\)/);
assert.match(permissionUi, /#confidential-documents-card/);
assert.match(permissionUi, /\.documents-catalog/);

assert.match(permissions, /MANAGE_PROJECT_FILES:\s*'MANAGE_PROJECT_FILES'/);
assert.match(permissions, /\[ROLE\.INSPECTOR\]: INSPECTOR_ACCESS/);
assert.match(permissions, /capability !== CAPABILITY\.MANAGE_USERS/);
assert.match(permissions, /\[ROLE\.SUPERVISOR\]: READ_AND_COMMENT/);
assert.match(permissions, /\[ROLE\.FOREMAN\]: READ_AND_COMMENT/);

console.log('Confidential E2EE runtime UI regression checks passed.');
