import assert from 'node:assert/strict';
import { engineeringElapsedDays, normalizeEngineeringState } from '../js/engineering-tracker-core.js';

assert.deepEqual(normalizeEngineeringState({ sentAt: '2024-02-29', returnedAt: '2024-03-01', note: '  teste  ' }), {
  sentAt: '2024-02-29', returnedAt: '2024-03-01', note: 'teste'
});
assert.equal(engineeringElapsedDays({ sentAt: '2024-02-29', returnedAt: '2024-03-01' }), 1);
assert.throws(() => normalizeEngineeringState({ sentAt: '2025-02-29' }), /inválida/i);
assert.throws(() => normalizeEngineeringState({ sentAt: '2026-13-01' }), /inválida/i);
assert.throws(() => normalizeEngineeringState({ sentAt: '2026-08-31', returnedAt: '2026-08-30' }), /anterior/i);

console.log('engineering-tracker-date-boundaries.test.mjs: OK');
