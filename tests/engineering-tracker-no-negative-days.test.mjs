import assert from 'node:assert/strict';
import { engineeringElapsedDays } from '../js/engineering-tracker-core.js';
assert.equal(engineeringElapsedDays({ sentAt:'2026-08-28' }, '2026-08-27'), 0);
console.log('engineering-tracker-no-negative-days.test.mjs: OK');
