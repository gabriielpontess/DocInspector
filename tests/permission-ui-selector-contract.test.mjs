import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, index, permissionUi] = await Promise.all([
  readFile('js/app.js', 'utf8'),
  readFile('index.html', 'utf8'),
  readFile('js/permission-ui.js', 'utf8')
]);

const markupSources = `${app}\n${index}`;
const selectorsBlock = permissionUi.match(/const SELECTORS = \{([\s\S]*?)\n  \};/)?.[1] || '';
const protectedSelectors = [...selectorsBlock.matchAll(/'([^']+)'/g)].map(match => match[1]);

assert.ok(protectedSelectors.length > 0, 'permission selector map must expose protected selectors');

for (const selector of protectedSelectors) {
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    assert.ok(
      markupSources.includes(`id="${id}"`),
      `protected selector ${selector} must match an id rendered by app.js or index.html`
    );
    continue;
  }

  const attribute = selector.match(/^\[([a-z0-9-]+)/i)?.[1];
  if (attribute) {
    assert.ok(
      new RegExp(`\\b${attribute}(?:=|\\s|>)`, 'i').test(markupSources),
      `protected selector ${selector} must reference an attribute rendered by app.js or index.html`
    );
    continue;
  }

  assert.fail(`unsupported protected selector in contract test: ${selector}`);
}

for (const deadSelector of [
  '#save-not-found',
  '#confirm-scan',
  '#create-backup',
  '#restore-backup',
  '#add-copy',
  '[data-edit-copy-evidence]',
  '[data-remove-copy]'
]) {
  assert.ok(!protectedSelectors.includes(deadSelector), `dead selector ${deadSelector} must not return`);
}

for (const requiredSelector of [
  '#mark-not-found',
  '#scan-confirm',
  '#backup',
  '#restore',
  '#restore-file',
  '[data-copy-edit]',
  '[data-copy-delete]'
]) {
  assert.ok(protectedSelectors.includes(requiredSelector), `${requiredSelector} must remain protected`);
}

console.log(`Permission UI selector contract checks passed for ${protectedSelectors.length} protected selectors.`);
