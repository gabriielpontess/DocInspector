import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(index, /type="module" src="js\/settings-refinement-ui\.js"/);
assert.ok(index.indexOf('js/settings-refinement-ui.js') < index.indexOf('js/auth-entry.js'), 'settings refinement must observe all app boot paths, including e2e/local bypass');
assert.match(sw, /\.\/js\/settings-refinement-ui\.js/);

console.log('Settings refinement entry contract passed.');
