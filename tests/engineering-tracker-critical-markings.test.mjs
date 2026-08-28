import assert from 'node:assert/strict';
import { ENGINEERING_MARKINGS } from '../js/engineering-tracker-core.js';

assert.deepEqual([...ENGINEERING_MARKINGS], ['Vermelho', 'Amarelo']);

console.log('engineering-tracker-critical-markings.test.mjs: OK');
