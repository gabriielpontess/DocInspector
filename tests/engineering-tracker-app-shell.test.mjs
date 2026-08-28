import assert from 'node:assert/strict';
import fs from 'node:fs';

const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../js/engineering-tracker-ui.js', import.meta.url), 'utf8');
const imports = [...ui.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)].map(match => match[1]);

for (const relativeImport of imports) {
  const asset = `./js/${relativeImport.replace(/^\.\//, '')}`;
  assert.ok(sw.includes(`'${asset}'`) || sw.includes(`"${asset}"`), `Engineering UI dependency ${asset} must be cached offline.`);
}

console.log('engineering-tracker-app-shell.test.mjs: OK');
