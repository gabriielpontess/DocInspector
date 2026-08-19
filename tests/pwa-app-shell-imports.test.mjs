import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [serviceWorker, syncAuth] = await Promise.all([
  readFile('sw.js', 'utf8'),
  readFile('js/sync-auth.js', 'utf8')
]);

const appShellMatch = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
assert.ok(appShellMatch, 'Service Worker must declare APP_SHELL.');
const appShell = appShellMatch[1];

const relativeImports = [...syncAuth.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)]
  .map(match => match[1])
  .filter(path => !path.includes('?'));

for (const relativeImport of relativeImports) {
  const normalized = `./js/${relativeImport.replace(/^\.\//, '')}`;
  assert.ok(
    appShell.includes(`'${normalized}'`) || appShell.includes(`"${normalized}"`),
    `Offline app shell must cache sync-auth dependency ${normalized}.`
  );
}

console.log('PWA app-shell dependency contract passed.');
