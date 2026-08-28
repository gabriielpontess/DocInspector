import assert from 'node:assert/strict';
import { normalizeEngineeringState } from '../js/engineering-tracker-core.js';

const value = normalizeEngineeringState({ sentAt: '2026-08-01', note: 'x'.repeat(1500) });
assert.equal(value.note.length, 1000);

console.log('engineering-tracker-note-limit.test.mjs: OK');
