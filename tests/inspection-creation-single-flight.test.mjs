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

const [guardSource, authConfigSource, appSource, uiSource, legacySyncSource, authSyncSource, legacySql, authSql] = await Promise.all([
  readFile('js/inspection-creation-guard.js', 'utf8'),
  readFile('js/auth-config.js', 'utf8'),
  readFile('js/app.js', 'utf8'),
  readFile('js/ui.js', 'utf8'),
  readFile('js/sync.js', 'utf8'),
  readFile('js/sync-auth.js', 'utf8'),
  readFile('SUPABASE-SETUP.sql', 'utf8'),
  readFile('supabase/migrations/20260817163849_add_authenticated_inspection_and_storage_access.sql', 'utf8')
]);

assert.match(authConfigSource, /import\s+['"]\.\/inspection-creation-guard\.js['"]/,
  'o guard deve carregar antes da aplicação tanto no modo autenticado quanto no legado');
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

const prepareImportBody = appSource.slice(
  appSource.indexOf('async function prepareImport'),
  appSource.indexOf('function mappingModal')
);
assert.ok(prepareImportBody.indexOf("setButtonBusy(button, true, 'Lendo planilha…')") >= 0,
  'a leitura da planilha deve sinalizar busy antes do await');
assert.ok(
  prepareImportBody.indexOf("setButtonBusy(button, true, 'Lendo planilha…')") < prepareImportBody.indexOf('await readWorkbook(file)'),
  'o botão Continuar deve ser bloqueado antes da leitura assíncrona'
);

const finishImportBody = appSource.slice(
  appSource.indexOf('async function finishImport'),
  appSource.indexOf('async function openInspection')
);
assert.ok(finishImportBody.indexOf("setButtonBusy(button, true, 'Criando…')") >= 0,
  'a criação deve sinalizar busy');
assert.ok(
  finishImportBody.indexOf("setButtonBusy(button, true, 'Criando…')") < finishImportBody.indexOf('const inspection = createInspection(meta)'),
  'o botão Criar inspeção deve ser bloqueado antes de gerar o id da inspeção'
);
assert.ok(
  finishImportBody.indexOf('const inspection = createInspection(meta)') < finishImportBody.indexOf('await saveInspection(inspection)'),
  'a mesma instância/id criada no client deve ser persistida localmente antes da sincronização'
);

for (const [label, source] of [['legado', legacySyncSource], ['autenticado', authSyncSource]]) {
  assert.match(source, /p_inspection_id:\s*inspection\.id/,
    `o sync ${label} deve reenviar o mesmo inspection.id, preservando a chave idempotente`);
}

function normalizedSql(source) {
  return source.toLowerCase().replace(/\s+/g, ' ');
}

for (const [label, source] of [['legado', legacySql], ['autenticado', authSql]]) {
  const sql = normalizedSql(source);
  assert.ok(sql.includes('on conflict (workspace_id, id) do update'),
    `o RPC ${label} deve permanecer idempotente pela chave (workspace_id, id)`);
}

console.log('inspection creation single-flight/idempotency regression: ok');
