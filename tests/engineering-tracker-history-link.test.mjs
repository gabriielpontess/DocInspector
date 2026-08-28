import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../js/engineering-tracker-ui.js', import.meta.url), 'utf8');
const recovery = fs.readFileSync(new URL('../js/recovery-ui.js', import.meta.url), 'utf8');

assert.match(ui, /data-open-document-history/);
assert.match(ui, /openDocumentTrash\(\)/);
assert.match(recovery, /async function openDocumentTrash\(\)/);
assert.match(recovery, /Restaurar documento/);
assert.match(recovery, /CAPABILITY\.MANAGE_DOCUMENTS/);

console.log('engineering-tracker-history-link.test.mjs: OK');
