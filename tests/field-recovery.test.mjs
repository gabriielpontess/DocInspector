import assert from 'node:assert/strict';
import fs from 'node:fs';

const recovery = fs.readFileSync(new URL('../js/field-recovery-ui.js', import.meta.url), 'utf8');
const authEntry = fs.readFileSync(new URL('../js/auth-entry.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../js/sync-auth.js', import.meta.url), 'utf8');

assert.match(authEntry, /import\('\.\/field-recovery-ui\.js'\)/, 'módulo de recuperação deve carregar após o gate de autenticação');
assert.match(sw, /\.\/js\/field-recovery-ui\.js/, 'módulo de recuperação deve funcionar offline');
assert.match(recovery, /docinspector-verification-drafts-v1/, 'rascunhos devem possuir namespace versionado');
assert.match(recovery, /localStorage\.getItem\('sky17-current'\)/, 'fingerprint do rascunho deve incluir o ID da inspeção atual');
assert.match(recovery, /return `\$\{inspectionId\}::\$\{origin\}::\$\{code\}`/, 'rascunhos de inspeções diferentes nunca devem compartilhar a mesma chave');
assert.match(recovery, /pagehide/, 'rascunho deve ser persistido quando a página for interrompida');
assert.match(recovery, /visibilitychange/, 'rascunho deve ser persistido quando o app for para segundo plano');
assert.match(recovery, /Rascunho recuperado/, 'usuário deve ser informado quando dados forem restaurados');
assert.match(recovery, /liveHasContent/, 'restauração não deve substituir entrada atual');
assert.match(recovery, /MAX_AGE_MS/, 'rascunhos antigos precisam expirar');
assert.match(recovery, /MAX_DRAFTS/, 'armazenamento de rascunhos precisa ser limitado');
assert.match(recovery, /pendingClearKey/, 'rascunho só deve ser removido após saída bem-sucedida do documento');

assert.match(sync, /if \(!navigator\.onLine\)[\s\S]*Offline · salvo localmente/, 'sync autenticado deve declarar salvamento local enquanto offline');
assert.match(sync, /window\.addEventListener\('online',[\s\S]*syncNow/, 'sync autenticado deve retomar automaticamente ao recuperar conexão');
assert.match(sync, /visibilitychange[\s\S]*syncNow/, 'sync autenticado deve retomar quando o app voltar ao primeiro plano');
assert.match(sync, /if \(activeSyncPromise\) return activeSyncPromise/, 'sync autenticado deve continuar single-flight após retomada');

console.log('field-recovery.test.mjs: OK');
