import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const db = fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8');
const pwa = fs.readFileSync(new URL('../js/pwa.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(db, /CONCURRENT_MODIFICATION/, 'IndexedDB deve detectar concorrência');
assert.match(app, /saveFieldChangeResilient/, 'registros de campo devem conciliar concorrência');
assert.match(app, /version:\s*4/, 'backup deve usar formato v4');
assert.match(app, /SHA-256/, 'backup deve possuir verificação SHA-256');
assert.match(app, /localOnlyNotIncluded/, 'backup deve registrar evidências locais não incluídas');
assert.match(app, /runFieldReadinessCheck/, 'deve existir diagnóstico pré-campo');
assert.match(pwa, /prepareOfflineDependencies/, 'PWA deve preparar dependências offline explicitamente');
assert.match(sw, /event\.ports\?\.\[0\]\?\.postMessage/, 'Service Worker deve confirmar preparação do cache');
console.log('v0.9.6 resilience tests OK');
