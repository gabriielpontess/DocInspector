import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSingleFlightGate } from '../js/inspection-creation-guard.js';

const gate = createSingleFlightGate();
const token = {};
assert.equal(gate.enter(token), true, 'a primeira submissão deve entrar no gate');
assert.equal(gate.enter(token), false, 'a mesma submissão não pode entrar duas vezes enquanto estiver ativa');
assert.equal(gate.has(token), true, 'o gate deve registrar a submissão ativa');
gate.release(token);
assert.equal(gate.has(token), false, 'a submissão deve ser liberada ao terminar');
assert.equal(gate.enter(token), true, 'uma tentativa posterior deve poder ser executada');

const [guardSource, authConfigSource, appSource, uiSource, swSource, legacySyncSource, authSyncSource, legacySql, authSql] = await Promise.all([
  readFile('js/inspection-creation-guard.js', 'utf8'),
  readFile('js/auth-config.js', 'utf8'),
  readFile('js/app.js', 'utf8'),
  readFile('js/ui.js', 'utf8'),
  readFile('sw.js', 'utf8'),
  readFile('js/sync.js', 'utf8'),
  readFile('js/sync-auth.js', 'utf8'),
  readFile('SUPABASE-SETUP.sql', 'utf8'),
  readFile('supabase/migrations/20260817163849_add_authenticated_inspection_and_storage_access.sql', 'utf8')
]);

assert.match(authConfigSource, /import\s+['"]\.\/inspection-creation-guard\.js['"]/,
  'o guard deve carregar antes da aplicação tanto no modo autenticado quanto no legado');
assert.match(swSource, /['"]\.\/js\/inspection-creation-guard\.js['"]/,
  'dependência de boot deve integrar o APP_SHELL para reabertura PWA offline');
assert.match(guardSource, /#new-inspection-hero/,
  'a abertura do modal também deve rejeitar uma segunda abertura concorrente');
assert.match(guardSource, /#read-file,\s*#finish-import/,
  'as duas etapas assíncronas da criação devem estar protegidas');
assert.match(guardSource, /addEventListener\(['"]click['"],\s*guardCreationClick,\s*true\)/,
  'o guard precisa rodar na fase de captura antes dos handlers da aplicação');
assert.match(guardSource, /stopImmediatePropagation\(\)/,
  'eventos duplicados devem ser interrompidos antes de alcançar o handler real');
assert.match(guardSource, /button\.disabled\s*\|\|\s*!submitGate\.enter\(button\)/,
  'o guard deve bloquear inclusive eventos programáticos em botão já ocupado');

assert.match(uiSource, /button\.disabled\s*=\s*true/,
  'setButtonBusy deve continuar desabilitando o controle durante operações assíncronas');

const prepareStart = appSource.indexOf('async function prepareImport');
const prepareBusy = appSource.indexOf("setButtonBusy(button, true, 'Lendo planilha…')", prepareStart);
const workbookAwait = appSource.indexOf('await readWorkbook(file)', prepareStart);
assert.ok(prepareStart >= 0 && prepareBusy >= prepareStart,
  'a leitura da planilha deve sinalizar busy');
assert.ok(workbookAwait > prepareBusy,
  'o botão Continuar deve ser bloqueado antes da leitura assíncrona');

const finishStart = appSource.indexOf('async function finishImport');
const finishBusy = appSource.indexOf("setButtonBusy(button, true, 'Criando…')", finishStart);
const createInspectionCall = appSource.indexOf('const inspection = createInspection(meta)', finishStart);
const saveInspectionCall = appSource.indexOf('await saveInspection(inspection)', createInspectionCall);
assert.ok(finishStart >= 0 && finishBusy >= finishStart,
  'a criação deve sinalizar busy');
assert.ok(createInspectionCall > finishBusy,
  'o botão Criar inspeção deve ser bloqueado antes de gerar o id da inspeção');
assert.ok(saveInspectionCall > createInspectionCall,
  'a mesma instância/id criada no client deve ser persistida localmente antes da sincronização');

for (const [label, source] of [['legado', legacySyncSource], ['autenticado', authSyncSource]]) {
  assert.match(source, /p_inspection_id:\s*inspection\.id/,
    `o sync ${label} deve reenviar o mesmo inspection.id, preservando a chave idempotente`);
}

const rpcIdempotencyPattern = /on\s+conflict\s*\(\s*workspace_id\s*,\s*id\s*\)\s*do\s+update/i;
for (const [label, source] of [['legado', legacySql], ['autenticado', authSql]]) {
  assert.match(source, rpcIdempotencyPattern,
    `o RPC ${label} deve permanecer idempotente pela chave (workspace_id, id)`);
}

console.log('inspection creation single-flight/idempotency regression: ok');
