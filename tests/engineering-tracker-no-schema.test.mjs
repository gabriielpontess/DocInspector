import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../js/engineering-tracker-core.js', import.meta.url), 'utf8');
const treeManifest = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url));

assert.match(core, /document\.engineering\.updated/);
assert.equal(treeManifest.some(name => /engineering/i.test(name)), false, 'Engineering tracker must not introduce a database migration for payload-only state.');

console.log('engineering-tracker-no-schema.test.mjs: OK');
