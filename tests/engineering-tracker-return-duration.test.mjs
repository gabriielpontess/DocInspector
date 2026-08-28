import assert from 'node:assert/strict';
import { engineeringElapsedDays } from '../js/engineering-tracker-core.js';
assert.equal(engineeringElapsedDays({ sentAt:'2026-08-01', returnedAt:'2026-08-05' }, '2026-08-28'), 4);
console.log('engineering-tracker-return-duration.test.mjs: OK');
