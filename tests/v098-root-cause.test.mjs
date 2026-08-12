import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

const toolbarRules = (css.match(/\.documents-toolbar\s*\{/g) || []).length;
assert.equal(toolbarRules, 1, 'documents-toolbar deve possuir uma única regra estrutural principal');
assert.match(css, /\.documents-toolbar\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/, 'toolbar deve responder à largura real do container');
assert.match(css, /\.documents-toolbar > \*[\s\S]*min-width:\s*0;/, 'filhos da toolbar devem poder encolher');
assert.match(css, /\.topbar\s*\{\s*flex-wrap:\s*wrap;/, 'topbar deve poder refluír');
assert.match(css, /\.inspection-item\s*\{\s*flex-wrap:\s*wrap;/, 'cards de inspeção devem poder refluír');
assert.match(css, /\.search-box,[\s\S]*description-cell\s*\{\s*flex-wrap:\s*wrap;/, 'busca e descrição devem evitar overflow horizontal');

assert.match(sync, /let activeSyncPromise = null;/, 'sincronização deve ser single-flight');
assert.match(sync, /if \(activeSyncPromise\) return activeSyncPromise;/, 'chamadas concorrentes devem aguardar a sincronização ativa');
assert.match(sync, /storageWriteVerified:\s*true/, 'teste do Storage deve comprovar gravação');
assert.match(sync, /storageDeleteVerified:\s*true/, 'teste do Storage deve comprovar exclusão');
assert.match(sync, /\.upload\(probePath, probeBlob/, 'diagnóstico deve executar upload real de teste');
assert.match(sync, /lastSyncError/, 'falha de evidência deve ser rastreável');
assert.doesNotMatch(sync, /if \(!evidence\?\.blob\) continue;/, 'evidência ausente não pode ser ignorada silenciosamente');

assert.match(app, /missingLocalBlob/, 'diagnóstico deve distinguir blob local ausente');
assert.match(app, /failedUpload/, 'diagnóstico deve distinguir falha real de upload');
assert.match(app, /await syncNow\(\{ announce: false \}\)/, 'diagnóstico deve aguardar sincronização efetiva');
console.log('v0.9.8 root-cause regression tests OK');
