import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, permissionUi] = await Promise.all([
  readFile('js/app.js', 'utf8'),
  readFile('js/permission-ui.js', 'utf8')
]);

function dataAttributes(source) {
  return new Set([...source.matchAll(/\b(data-[a-z0-9-]+)(?==)/gi)].map(match => match[1]));
}

function permissionDataSelectors(source) {
  return new Set([...source.matchAll(/'\[(data-[a-z0-9-]+)(?:=[^\]]+)?\]'/gi)].map(match => match[1]));
}

const renderedAttributes = dataAttributes(app);
const protectedAttributes = permissionDataSelectors(permissionUi);

for (const attribute of ['data-copy-edit', 'data-copy-delete']) {
  assert.ok(renderedAttributes.has(attribute), `${attribute} must be rendered by app.js`);
  assert.ok(protectedAttributes.has(attribute), `${attribute} must be protected by permission-ui.js`);
}

assert.ok(!protectedAttributes.has('data-edit-copy-evidence'), 'dead copy edit selector must not return');
assert.ok(!protectedAttributes.has('data-remove-copy'), 'dead copy delete selector must not return');

console.log('Permission UI selector contract checks passed.');
