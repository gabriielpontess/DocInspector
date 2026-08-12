import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const db = fs.readFileSync(new URL('../js/db.js', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
const pwa = fs.readFileSync(new URL('../js/pwa.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(app, /function hasActiveVerificationDraft\(\)/, 'deve proteger rascunho de verificação');
assert.match(app, /detail && !hasActiveVerificationDraft\(\)/, 'sync não deve reconstruir formulário com rascunho ativo');
assert.match(db, /saveInspectionWithEvidenceDeletion/, 'exclusão de cópia/evidência deve ser transacional');
assert.match(app, /saveInspectionWithEvidenceDeletion\(state\.current/, 'UI deve usar a transação de exclusão consolidada');
assert.match(sync, /testConfiguredSyncConnection/, 'teste configurado deve validar workspace e storage');
assert.match(sync, /storage\.from\(EVIDENCE_BUCKET\)\.list/, 'teste deve verificar bucket de evidências');
assert.doesNotMatch(sync, /publishableKey: sanitizePublishableKey\(publishableKey\),\s*publishableKey:/, 'config não deve duplicar publishableKey');
assert.doesNotMatch(sync, /if \(!pending\.length\) return;\s*if \(!pending\.length\) return;/, 'fila não deve conter guard duplicado');
assert.doesNotMatch(pwa, /updatefound|controllerchange|SKIP_WAITING/, 'PWA não deve forçar reload durante trabalho ativo');
assert.doesNotMatch(sw, /install[\s\S]{0,500}self\.skipWaiting\(\)/, 'install não deve ativar atualização imediatamente');
assert.match(sw, /Promise\.allSettled/, 'cache externo deve ser aquecido em paralelo');
console.log('v0.9.4 field readiness tests OK');
