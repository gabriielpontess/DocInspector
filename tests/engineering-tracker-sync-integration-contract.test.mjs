import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync = fs.readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
assert.match(sync, /function mergeDocumentAudit/);
assert.match(sync, /documentAudit: mergeDocumentAudit\(local\.documentAudit, remote\.documentAudit\)/);
assert.match(sync, /\.slice\(-1000\)/);

console.log('engineering-tracker-sync-integration-contract.test.mjs: OK');
