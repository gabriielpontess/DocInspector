import assert from 'node:assert/strict';
import fs from 'node:fs';

const plan = fs.readFileSync(new URL('../docs/engineering/ENGINEERING-TRACKER-TEST-PLAN.md', import.meta.url), 'utf8');

assert.match(plan, /green CI result is necessary but not sufficient/i);
assert.match(plan, /320 px mobile layout/);
assert.match(plan, /stale-device merge/);
assert.match(plan, /published preview or production-like deployment/);
assert.match(plan, /authoritative inspection-list replacement/);
assert.match(plan, /retirement of new confidential-PDF upload/);
assert.match(plan, /OCR engineering pipeline/);

console.log('engineering-tracker-test-plan.test.mjs: OK');
