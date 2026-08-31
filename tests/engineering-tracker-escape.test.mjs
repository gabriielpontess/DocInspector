import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../js/engineering-tracker-ui.js', import.meta.url), 'utf8');
for (const expression of ['document.code','document.description','inspection.system','engineering.note']) {
  assert.ok(ui.includes(`escapeHtml(${expression}`), `${expression} must be HTML-escaped before rendering`);
}

console.log('engineering-tracker-escape.test.mjs: OK');
