import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../js/engineering-tracker-core.js', import.meta.url), 'utf8');
assert.doesNotMatch(core, /supabase|indexedDB|fetch\(/i);
assert.match(core, /documentAudit/);

console.log('engineering-tracker-no-direct-db.test.mjs: OK');
