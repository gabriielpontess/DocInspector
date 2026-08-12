import fs from 'node:fs';
import assert from 'node:assert/strict';
const css=fs.readFileSync(new URL('../styles.css',import.meta.url),'utf8');

for (const pattern of [
  /\.new-inspection-callout > div:first-child\s*\{[^}]*flex:\s*1 1 \d+px/s,
  /\.inspection-summary\s*\{[^}]*flex:\s*1 1 \d+px/s,
  /\.search-box input\s*\{[^}]*flex:\s*1 1 \d+px/s,
  /\.description-cell > div\s*\{[^}]*flex:\s*1 1 \d+px/s
]) {
  assert.doesNotMatch(css, pattern, 'componentes que viram coluna no mobile não podem usar flex-basis em px');
}

assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.new-inspection-callout > div:first-child[\s\S]*flex-basis:\s*auto/);
assert.match(css, /\.new-inspection-callout[\s\S]*height:\s*auto/);
assert.match(css, /\.inspection-item[\s\S]*height:\s*auto/);
console.log('v0.9.11 responsive axis tests OK');
