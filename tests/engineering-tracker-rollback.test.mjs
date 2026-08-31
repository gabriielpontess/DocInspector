import assert from 'node:assert/strict';
import fs from 'node:fs';

const rollback = fs.readFileSync(new URL('../docs/engineering/ENGINEERING-TRACKER-ROLLBACK.md', import.meta.url), 'utf8');

assert.match(rollback, /no database migration/i);
assert.match(rollback, /code-only/i);
assert.match(rollback, /document\.engineering\.updated/);
assert.match(rollback, /does not require deleting those audit events/i);
assert.match(rollback, /Do not purge or rewrite existing inspection audit events/i);

console.log('engineering-tracker-rollback.test.mjs: OK');
