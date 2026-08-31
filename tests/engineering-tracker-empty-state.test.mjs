import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../js/engineering-tracker-ui.js', import.meta.url), 'utf8');
assert.match(ui, /Nenhuma pendência Amarelo\/Vermelho/);
assert.match(ui, /Quando uma cópia de campo receber uma dessas marcações/);

console.log('engineering-tracker-empty-state.test.mjs: OK');
