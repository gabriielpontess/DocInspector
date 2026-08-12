import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

assert.match(app, /pwSearchQuery:\s*''/, 'A pesquisa deve possuir estado persistente entre renders');
assert.match(app, /value="\$\{escapeHtml\(state\.pwSearchQuery\)\}"/, 'O campo deve restaurar o texto digitado após renderizações');
assert.match(app, /function\s+documentSearchMatches\s*\(/, 'Busca assistida precisa existir');
assert.match(app, /document\.description/, 'Busca assistida deve considerar descrição');
assert.match(app, /data-search-doc/, 'Sugestões devem exigir seleção explícita');
assert.match(css, /touch-action:\s*manipulation/, 'Navegação móvel deve evitar zoom por toque duplo');
console.log('search-ui.test.mjs: OK');
