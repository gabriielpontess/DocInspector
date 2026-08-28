import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../js/engineering-tracker-ui.js', import.meta.url), 'utf8');

assert.match(ui, /data-engineering-search/);
assert.match(ui, /data-engineering-filter-marking/);
assert.match(ui, /data-engineering-filter-status/);
assert.match(ui, /AWAITING_RETURN/);
assert.match(ui, /RETURNED/);
assert.match(ui, /row\.hidden = !\(matchesQuery && matchesMarking && matchesStatus\)/);
assert.doesNotMatch(ui, /saveInspection\([^\n]*applyFilters/, 'filtering must remain a view-only operation');

console.log('engineering-tracker-filter-contract.test.mjs: OK');
