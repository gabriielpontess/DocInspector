import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.equal(packageJson.version, '0.10.0', 'package.json deve declarar a versão do release');
assert.match(app, /const APP_VERSION = '0\.10\.0';/, 'versão exibida e registrada nos backups deve corresponder ao release');
assert.match(changelog, /^## v0\.10\.0 —/m, 'CHANGELOG deve documentar o release v0.10.0');
assert.match(sw, /const VERSION = '0\.9\.42';/, 'identidade técnica do cache deve avançar quando o app shell pós-release muda');

console.log('Release version consistency checks passed.');
