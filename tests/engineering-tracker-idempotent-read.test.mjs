import assert from 'node:assert/strict';
import { currentEngineeringState } from '../js/engineering-tracker-core.js';

const inspection = { documentAudit: [{ id:'e1', action:'document.engineering.updated', documentId:'d1', at:'2026-08-01T00:00:00.000Z', actor:null, changes:{ sentAt:'2026-08-01', returnedAt:null, note:'x' } }] };
const before = structuredClone(inspection);
assert.equal(currentEngineeringState(inspection, 'd1').note, 'x');
assert.deepEqual(inspection, before);

console.log('engineering-tracker-idempotent-read.test.mjs: OK');
