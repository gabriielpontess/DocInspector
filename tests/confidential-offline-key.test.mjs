import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const offlineKey = await readFile('js/confidential-offline-key.js', 'utf8');
const ui = await readFile('js/confidential-e2ee-ui.js', 'utf8');
const permissionUi = await readFile('js/permission-ui.js', 'utf8');

assert.match(offlineKey, /docinspector-confidential-envelopes-v1/);
assert.match(offlineKey, /wrappedWorkspaceKey:\s*wrapped\.slice\(\)\.buffer/);
assert.match(offlineKey, /unlockCachedWorkspaceKey/);
assert.match(offlineKey, /unlockConfidentialWorkspaceKeyResilient/);
assert.match(offlineKey, /unwrapWorkspaceKeyForMember/);
assert.match(offlineKey, /importAes256Key\(raw, \{ extractable: false \}\)/);
assert.match(offlineKey, /raw\.fill\(0\)/);
assert.match(offlineKey, /wrapped\.fill\(0\)/);
assert.doesNotMatch(offlineKey, /localStorage|sessionStorage/);
assert.doesNotMatch(offlineKey, /service[_-]?role/i);
assert.doesNotMatch(offlineKey, /workspaceKeyBytes\s*:/);

assert.match(ui, /cacheCurrentWorkspaceEnvelope/);
assert.match(ui, /hasCachedWorkspaceEnvelope/);
assert.match(ui, /unlockConfidentialWorkspaceKeyResilient/);
assert.match(ui, /keyVersion:\s*Number\(documentRecord\.workspace_key_version\)/);
assert.doesNotMatch(ui, /unlockConfidentialWorkspaceKey\s*\(/);

assert.match(permissionUi, /clearLocalConfidentialKeys/);
assert.match(permissionUi, /clearAllConfidentialCiphertext/);
assert.match(permissionUi, /clearCachedWorkspaceEnvelopes/);
assert.match(permissionUi, /Promise\.allSettled/);

console.log('Confidential offline key-envelope and logout regression checks passed.');
