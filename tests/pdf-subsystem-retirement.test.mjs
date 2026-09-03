import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const permissionUi = fs.readFileSync(new URL('../js/permission-ui.js', import.meta.url), 'utf8');
const userAdminUi = fs.readFileSync(new URL('../js/user-admin-ui.js', import.meta.url), 'utf8');
const recoveryCore = fs.readFileSync(new URL('../js/recovery-core.js', import.meta.url), 'utf8');
const recoveryUi = fs.readFileSync(new URL('../js/recovery-ui.js', import.meta.url), 'utf8');
const managementUi = fs.readFileSync(new URL('../js/document-management-ui.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const report = fs.readFileSync(new URL('../js/report.js', import.meta.url), 'utf8');
const purgeMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260903161831_remove_confidential_pdf_database_subsystem.sql', import.meta.url),
  'utf8'
);

assert.equal(packageJson.dependencies?.['pdfjs-dist'], undefined, 'PDF.js não pode permanecer como dependência npm');
assert.equal(packageJson.scripts?.['build:pdfjs'], undefined, 'build dedicado ao PDF.js deve ser removido');
assert.equal(packageJson.scripts?.['pretest:e2e'], undefined, 'E2E não deve preparar PDF.js');

const jsFiles = fs.readdirSync(new URL('../js/', import.meta.url));
assert.equal(jsFiles.some(name => name.startsWith('confidential-')), false, 'módulos confidential-* devem ser removidos');
assert.equal(jsFiles.includes('pdf-upload-retirement.js'), false, 'shim de upload de PDF não deve permanecer');
assert.equal(fs.existsSync(new URL('../vendor/pdfjs/', import.meta.url)), false, 'vendor PDF.js deve ser removido');

for (const [name, source] of [
  ['index.html', index],
  ['sw.js', sw],
  ['permission-ui.js', permissionUi],
  ['user-admin-ui.js', userAdminUi],
  ['recovery-core.js', recoveryCore],
  ['recovery-ui.js', recoveryUi],
  ['document-management-ui.js', managementUi]
]) {
  assert.doesNotMatch(source, /confidential-|docinspector-confidential-pdfs|\.dipdf|vendor\/pdfjs|pdfjs-dist/i, `${name} não deve referenciar o subsistema retirado`);
}

assert.doesNotMatch(permissionUi, /clearLocalConfidentialKeys|clearAllConfidentialCiphertext|clearCachedWorkspaceEnvelopes/, 'logout não deve executar limpeza de cofre retirado');
assert.doesNotMatch(userAdminUi, /E2EE|Workspace Key|rotation|rotação|rewrap/i, 'gestão de usuários não deve depender de rotação criptográfica');
assert.doesNotMatch(recoveryUi, /docinspector_project_documents|MANAGE_PROJECT_FILES|\bPDFs?\b/i, 'lixeira de documentos deve ser independente de PDF');
assert.doesNotMatch(recoveryCore, /buildPdf|splitConfidential/i, 'core de recuperação deve conter apenas documentos');
assert.doesNotMatch(managementUi, /PDFs? vinculados|apenas o PDF/i, 'gestão de documentos não deve carregar mensagens de PDF');

// O expurgo de banco deve remover toda a superfície específica do recurso.
for (const artifact of [
  'docinspector_workspace_members_guard_e2ee_deactivation',
  'docinspector_project_documents',
  'docinspector_workspace_key_envelopes',
  'docinspector_member_key_backups',
  'docinspector_member_public_keys',
  'docinspector_workspace_crypto_keys',
  'docinspector_confidential_pdf_config',
  'docinspector_workspace_key_rotations'
]) {
  assert.match(purgeMigration, new RegExp(`drop (?:trigger|table).*${artifact}`, 'is'), `${artifact} deve ser removido pela migração de expurgo`);
}
assert.doesNotMatch(purgeMigration, /delete\s+from\s+storage\.objects/i, 'objetos Storage não podem ser excluídos por SQL');
assert.doesNotMatch(purgeMigration, /drop\s+table\s+(?:if\s+exists\s+)?storage\./i, 'schema Storage não pode ser alterado pela migração');
assert.match(purgeMigration, /drop policy if exists docinspector_confidential_pdf_(?:delete|insert|select)/i, 'políticas do bucket retirado devem ser fechadas');

// A geração do relatório de inspeção em PDF é uma capacidade distinta e permanece.
assert.match(index, /jspdf@4\.0\.0\/dist\/jspdf\.umd\.min\.js/, 'jsPDF do relatório deve permanecer');
assert.match(sw, /const JSPDF_URL = /, 'jsPDF do relatório deve continuar disponível offline');
assert.match(app, /exportInspectionPdf/, 'aplicação deve manter exportação do relatório');
assert.match(report, /jspdf/i, 'gerador do relatório deve continuar usando jsPDF');

console.log('Confidential PDF subsystem retirement contracts passed.');
