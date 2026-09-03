import fs from 'node:fs';

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(path, before, after) {
  const source = read(path);
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${path}: trecho esperado não encontrado:\n${before.slice(0, 180)}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${path}: trecho esperado aparece mais de uma vez`);
  write(path, source.slice(0, first) + after + source.slice(first + before.length));
}
function replaceAllChecked(path, before, after, min = 1) {
  const source = read(path);
  const count = source.split(before).length - 1;
  if (count < min) throw new Error(`${path}: esperado ao menos ${min} ocorrência(s), obtido ${count}`);
  write(path, source.split(before).join(after));
}

const appPath = 'js/app.js';
replaceOnce(appPath,
  "const app = document.querySelector('#app');\nconst state = {",
  "const app = document.querySelector('#app');\nlet verificationMutationInFlight = false;\nconst state = {"
);

replaceOnce(appPath,
`function formatInspectionCount(total) {
  return \`${'${total}'} ${'${total === 1 ? \'inspeção\' : \'inspeções\'}'}\`;
}

function allDocumentContexts() {`,
`function formatInspectionCount(total) {
  return \`${'${total}'} ${'${total === 1 ? \'inspeção\' : \'inspeções\'}'}\`;
}

function compareAlphabetically(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });
}

function sortedInspections() {
  return [...state.inspections].sort((a, b) =>
    compareAlphabetically(a.system, b.system) ||
    compareAlphabetically(a.name || a.project, b.name || b.project) ||
    compareAlphabetically(a.id, b.id)
  );
}

function sortedInspectionDocuments(inspection) {
  return [...(inspection?.documents || [])].sort((a, b) =>
    compareAlphabetically(a.code, b.code) ||
    compareAlphabetically(a.description, b.description) ||
    compareAlphabetically(a.id, b.id)
  );
}

function allDocumentContexts() {`
);

replaceOnce(appPath,
`function homeView() {
  const contexts = allDocumentContexts();
  const systems = [...new Set(state.inspections.map(item => item.system).filter(Boolean))];
  const syncStatus = getSyncStatus();
  const inspectionList = state.inspections.map(inspection => {`,
`function homeView() {
  const contexts = allDocumentContexts();
  const homeInspections = sortedInspections();
  const systems = [...new Set(homeInspections.map(item => item.system).filter(Boolean))];
  const syncStatus = getSyncStatus();
  const inspectionList = homeInspections.map(inspection => {`
);

replaceOnce(appPath,
"    .sort((a, b) => b.score - a.score || a.context.document.code.localeCompare(b.context.document.code, 'pt-BR'))",
"    .sort((a, b) => b.score - a.score || compareAlphabetically(a.context.document.code, b.context.document.code))"
);

replaceOnce(appPath,
`function bindSearchSuggestionActions(root = document) {
  root.querySelectorAll('[data-search-doc]').forEach(button => {
    button.addEventListener('click', () => selectSearchDocument(button.dataset.searchDoc, button.dataset.searchInspection));
  });
}`,
`function bindSearchSuggestionActions(root = document) {
  root.querySelectorAll('[data-search-doc]').forEach(button => {
    if (button.dataset.searchBound === '1') return;
    button.dataset.searchBound = '1';
    button.addEventListener('click', () => selectSearchDocument(button.dataset.searchDoc, button.dataset.searchInspection));
  });
}`
);

replaceOnce(appPath,
`  const resultClass = document.result.replaceAll(' ', '-');
  const copyCount = document.fieldCopies?.length || 0;
  const markings = documentMarkings(document);
  const hasNext = (inspection.documents || []).length > 1;`,
`  const resultClass = document.result.replaceAll(' ', '-');
  const copyCount = document.fieldCopies?.length || 0;
  const markings = documentMarkings(document);
  const orderedDocuments = sortedInspectionDocuments(inspection);
  const orderedIndex = orderedDocuments.findIndex(item => item.id === document.id);
  const hasNext = orderedIndex >= 0 && orderedIndex < orderedDocuments.length - 1;`
);

replaceAllChecked(appPath,
"${state.inspections.map(item => `<option value=\"${escapeHtml(item.id)}\" ${state.docsFilters.inspectionId === item.id ? 'selected' : ''}>${escapeHtml(item.system || 'Sem sistema')} · ${escapeHtml(item.name || item.project)}</option>`).join('')}",
"${sortedInspections().map(item => `<option value=\"${escapeHtml(item.id)}\" ${state.docsFilters.inspectionId === item.id ? 'selected' : ''}>${escapeHtml(item.system || 'Sem sistema')} · ${escapeHtml(item.name || item.project)}</option>`).join('')}",
1
);

replaceOnce(appPath,
`<select id="sort-docs" aria-label="Ordenar documentos"><option value="code" ${'${state.docsFilters.sort === \'code\' ? \'selected\' : \'\'}'}>Ordenar por código</option><option value="description" ${'${state.docsFilters.sort === \'description\' ? \'selected\' : \'\'}'}>Ordenar por descrição</option><option value="system" ${'${state.docsFilters.sort === \'system\' ? \'selected\' : \'\'}'}>Ordenar por sistema</option></select>`,
`<select id="sort-docs" aria-label="Ordenar documentos"><option value="code" ${'${state.docsFilters.sort === \'code\' ? \'selected\' : \'\'}'}>Código PW · A–Z</option><option value="description" ${'${state.docsFilters.sort === \'description\' ? \'selected\' : \'\'}'}>Descrição · A–Z</option><option value="system" ${'${state.docsFilters.sort === \'system\' ? \'selected\' : \'\'}'}>Sistema · A–Z</option></select>`
);

replaceOnce(appPath,
`function goToNextDocument() {
  const context = selectedContext();
  if (!context) return;
  const documents = context.inspection.documents || [];
  if (documents.length < 2) return;
  const index = documents.findIndex(item => item.id === context.document.id);
  const next = documents[(index + 1 + documents.length) % documents.length];
  selectDocumentContext({ inspection: context.inspection, document: next }, { renderView: false });
  state.pwSearchQuery = next.code;
  render();
  requestAnimationFrame(() => document.querySelector('#found-revision')?.focus());
}`,
`function goToNextDocument() {
  const context = selectedContext();
  if (!context) return;
  const documents = sortedInspectionDocuments(context.inspection);
  const index = documents.findIndex(item => item.id === context.document.id);
  if (index < 0 || index >= documents.length - 1) return;
  const next = documents[index + 1];
  selectDocumentContext({ inspection: context.inspection, document: next }, { renderView: false });
  state.pwSearchQuery = next.code;
  render();
  requestAnimationFrame(() => document.querySelector('#found-revision')?.focus());
}`
);

replaceOnce(appPath,
`async function saveVerification(event) {
  const button = event?.currentTarget;
  const snapshot = state.selectedDoc ? structuredClone(state.selectedDoc) : null;
  try {`,
`async function saveVerification(event) {
  if (verificationMutationInFlight) return;
  verificationMutationInFlight = true;
  const button = event?.currentTarget;
  const snapshot = state.selectedDoc ? structuredClone(state.selectedDoc) : null;
  try {`
);
replaceOnce(appPath,
`    showToast(\`${'${quantity}'} ${'${quantity === 1 ? \'cópia registrada\' : \'cópias registradas\'}'}: ${'${state.selectedDoc.result}'}.\`);
    returnToSearch();
  } catch (error) {
    if (snapshot) restoreDocumentSnapshot(snapshot);
    showToast(error.message || 'Falha ao salvar a verificação.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function saveNotFound(event) {
  const button = event?.currentTarget;`,
`    const savedInspectionId = context.inspection.id;
    const savedDocumentId = context.document.id;
    const refreshed = documentContext(savedInspectionId, savedDocumentId);
    const result = refreshed?.document?.result || state.selectedDoc.result;
    showToast(\`${'${quantity}'} ${'${quantity === 1 ? \'cópia registrada\' : \'cópias registradas\'}'}: ${'${result}'}.\`);
    keepVerificationSelection(savedInspectionId, savedDocumentId);
  } catch (error) {
    if (snapshot) restoreDocumentSnapshot(snapshot);
    showToast(error.message || 'Falha ao salvar a verificação.', 'error');
  } finally {
    verificationMutationInFlight = false;
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function saveNotFound(event) {
  if (verificationMutationInFlight) return;
  verificationMutationInFlight = true;
  const button = event?.currentTarget;`
);
replaceOnce(appPath,
`    showToast('Documento marcado como não encontrado.');
    returnToSearch();
  } catch (error) {
    if (snapshot) restoreDocumentSnapshot(snapshot);
    showToast(error.message || 'Falha ao salvar o registro.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

function returnToSearch() {`,
`    const savedInspectionId = context.inspection.id;
    const savedDocumentId = context.document.id;
    showToast('Documento marcado como não encontrado.');
    keepVerificationSelection(savedInspectionId, savedDocumentId);
  } catch (error) {
    if (snapshot) restoreDocumentSnapshot(snapshot);
    showToast(error.message || 'Falha ao salvar o registro.', 'error');
  } finally {
    verificationMutationInFlight = false;
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

function keepVerificationSelection(inspectionId, documentId) {
  const context = documentContext(inspectionId, documentId);
  if (!context) {
    returnToSearch();
    return false;
  }
  selectDocumentContext(context, { renderView: false });
  state.pwSearchQuery = context.document.code;
  render();
  return true;
}

function returnToSearch() {`
);

replaceOnce(appPath,
`    .sort((a, b) => {
      const av = sortBy === 'system' ? a.inspection.system : a.document[sortBy];
      const bv = sortBy === 'system' ? b.inspection.system : b.document[sortBy];
      return String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR', { numeric: true });
    });`,
`    .sort((a, b) => {
      const av = sortBy === 'system' ? a.inspection.system : a.document[sortBy];
      const bv = sortBy === 'system' ? b.inspection.system : b.document[sortBy];
      return compareAlphabetically(av, bv) || compareAlphabetically(a.document.code, b.document.code);
    });`
);

replaceOnce(appPath,
"listSelect.innerHTML = `<option value=\"\">Todas as listas</option>${state.inspections.map(item => `<option value=\"${escapeHtml(item.id)}\">${escapeHtml(item.system || 'Sem sistema')} · ${escapeHtml(item.name || item.project)}</option>`).join('')}`;",
"listSelect.innerHTML = `<option value=\"\">Todas as listas</option>${sortedInspections().map(item => `<option value=\"${escapeHtml(item.id)}\">${escapeHtml(item.system || 'Sem sistema')} · ${escapeHtml(item.name || item.project)}</option>`).join('')}`;"
);

const refinementPath = 'js/ui-refinement.js';
replaceOnce(refinementPath,
`function currentVerificationScope() {
  return document.querySelector('#verification-scope')?.value ?? verificationScopeId;
}

function scheduleRefinement() {`,
`function currentVerificationScope() {
  return document.querySelector('#verification-scope')?.value ?? verificationScopeId;
}

function compareAlphabetically(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function sortedDocuments(documents = []) {
  return [...documents].sort((a, b) =>
    compareAlphabetically(a.code, b.code) ||
    compareAlphabetically(a.description, b.description) ||
    compareAlphabetically(a.id, b.id)
  );
}

function sortedInspectionRecords(inspections = []) {
  return [...inspections].sort((a, b) =>
    compareAlphabetically(a.system, b.system) ||
    compareAlphabetically(a.name || a.project, b.name || b.project) ||
    compareAlphabetically(a.id, b.id)
  );
}

function scheduleRefinement() {`
);
replaceOnce(refinementPath,
"    const inspections = await listInspections();\n    if (!select.isConnected) return;",
"    const inspections = sortedInspectionRecords(await listInspections());\n    if (!select.isConnected) return;"
);
replaceAllChecked(refinementPath,
"const documents = inspection.documents || [];",
"const documents = sortedDocuments(inspection.documents || []);",
2
);
replaceAllChecked(refinementPath,
"const list = latest?.documents || [];",
"const list = sortedDocuments(latest?.documents || []);",
3
);

const recoveryPath = 'js/recovery-ui.js';
replaceOnce(recoveryPath,
`  const entries = inspections.flatMap(inspection =>
    listRestorableDeletedDocuments(inspection).map(entry => ({ inspection, entry }))
  );`,
`  const entries = inspections.flatMap(inspection =>
    listRestorableDeletedDocuments(inspection).map(entry => ({ inspection, entry }))
  ).sort((a, b) => String(a.entry.document.code || '').localeCompare(String(b.entry.document.code || ''), 'pt-BR', { numeric: true, sensitivity: 'base' }));`
);
replaceOnce(recoveryPath,
`        showToast(\`Documento restaurado com histórico preservado.${'${syncNote}'}\`, result.syncPending ? '' : 'success');
        modal.closeModal();`,
`        showToast(\`Documento restaurado com histórico preservado.${'${syncNote}'}\`, result.syncPending ? '' : 'success');
        row.remove();
        const list = modal.querySelector('[data-document-trash-list]');
        if (list && !list.querySelector('[data-document-trash-id]')) {
          list.innerHTML = '<div class="card empty"><div><strong>Lixeira vazia.</strong><small>Nenhum documento excluído está aguardando recuperação.</small></div></div>';
        }`
);

const uiPath = 'js/ui.js';
replaceOnce(uiPath,
`export function setButtonBusy(button, busy, busyText = 'Processando…') {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyText;
    return;
  }

  if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  delete button.dataset.originalText;
}`,
`export function setButtonBusy(button, busy, busyText = 'Processando…') {
  if (!button) return;

  if (busy) {
    const depth = Number(button.dataset.busyDepth || 0);
    if (depth === 0) button.dataset.originalText = button.innerHTML;
    button.dataset.busyDepth = String(depth + 1);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = busyText;
    return;
  }

  const depth = Math.max(0, Number(button.dataset.busyDepth || 1) - 1);
  if (depth > 0) {
    button.dataset.busyDepth = String(depth);
    return;
  }

  if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  delete button.dataset.originalText;
  delete button.dataset.busyDepth;
}`
);
replaceOnce(uiPath,
`export function openModal(content, { label = 'Janela de diálogo' } = {}) {
  const previousFocus = document.activeElement;
  const element = document.createElement('div');
  element.className = 'modal-backdrop';`,
`export function openModal(content, { label = 'Janela de diálogo' } = {}) {
  const modalLabel = String(label || 'Janela de diálogo');
  const existing = [...document.querySelectorAll('.modal-backdrop[data-modal-label]')]
    .find(item => item.dataset.modalLabel === modalLabel);
  if (existing) {
    const focusable = existing.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    return existing;
  }

  const previousFocus = document.activeElement;
  const element = document.createElement('div');
  element.className = 'modal-backdrop';
  element.dataset.modalLabel = modalLabel;`
);
replaceOnce(uiPath,
`  function close() {
    element.remove();
    document.body.classList.remove('modal-open');
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }`,
`  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    element.remove();
    if (!document.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }`
);

const swPath = 'sw.js';
replaceOnce(swPath,
`// Rotate the complete app-shell generation when runtime composition changes.
// This retirement revision evicts assets from the removed document-file subsystem.
const CACHE_REVISION = \`${'${VERSION}'}-pdf-retirement-1\`;`,
`// Rotate the complete app-shell generation when runtime interaction changes.
// This revision delivers alphabetical navigation, recovery continuity and action de-duplication atomically.
const CACHE_REVISION = \`${'${VERSION}'}-workflow-refinements-1\`;`
);

for (const name of fs.readdirSync('tests')) {
  if (!name.endsWith('.mjs')) continue;
  const path = `tests/${name}`;
  const source = read(path);
  if (source.includes('-pdf-retirement-1')) write(path, source.replaceAll('-pdf-retirement-1', '-workflow-refinements-1'));
}

const contractTest = `import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const refinement = fs.readFileSync(new URL('../js/ui-refinement.js', import.meta.url), 'utf8');
const recovery = fs.readFileSync(new URL('../js/recovery-ui.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(app, /function compareAlphabetically\\(a, b\\)/, 'app deve centralizar comparação A-Z');
assert.match(app, /const homeInspections = sortedInspections\\(\\)/, 'Home deve usar listas ordenadas');
assert.match(app, /Código PW · A–Z/, 'Documentos deve expor ordenação A-Z de forma explícita');
assert.match(app, /const documents = sortedInspectionDocuments\\(context\\.inspection\\)/, 'Próximo documento em campo deve seguir A-Z');
assert.match(app, /keepVerificationSelection\\(savedInspectionId, savedDocumentId\\)/, 'verificação salva deve permanecer selecionada');
assert.doesNotMatch(app, /showToast\\([^;]*cópia registrada[^;]*;\\s*returnToSearch\\(\\)/s, 'salvar verificação não deve expulsar o documento da tela');
assert.match(app, /verificationMutationInFlight/, 'gravações de verificação devem ser single-flight');
assert.match(app, /button\\.dataset\\.searchBound = '1'/, 'sugestões não podem acumular handlers duplicados');
assert.match(refinement, /sortedDocuments\\(inspection\\.documents \\|\\| \\[\\]\\)/, 'navegação refinada deve respeitar A-Z');
assert.match(recovery, /row\\.remove\\(\\)/, 'restauração deve atualizar a lixeira sem fechá-la');
assert.doesNotMatch(recovery, /showToast\\(\\`Documento restaurado[\\s\\S]{0,220}modal\\.closeModal\\(\\)/, 'restauração não pode fechar a lixeira automaticamente');
assert.match(ui, /data-modal-label/, 'modais duplicados com o mesmo rótulo devem ser reutilizados');
assert.match(ui, /let closed = false/, 'fechamento de modal deve ser idempotente');
assert.match(ui, /busyDepth/, 'estado busy deve tolerar handlers concorrentes sem reabilitar cedo');
assert.match(sw, /workflow-refinements-1/, 'PWA deve rotacionar o app shell para entregar as correções');

console.log('Workflow refinements regression contracts passed.');
`;
write('tests/workflow-refinements.test.mjs', contractTest);

const e2ePath = 'e2e/report-verification-navigation.spec.mjs';
let e2e = read(e2ePath);
e2e = e2e.replace('    beta.documents = [betaOne, betaTwo];\n\n    await replaceAllInspections([alpha, beta]);', '    beta.documents = [betaTwo, betaOne];\n\n    await replaceAllInspections([beta, alpha]);');
if (!e2e.includes("test('Home, Documentos e sequência de campo respeitam A-Z")) {
  e2e += `\n\ntest('Home, Documentos e sequência de campo respeitam A-Z', async ({ page }) => {\n  await seedInspections(page);\n\n  const cards = page.locator('.inspection-item');\n  await expect(cards.nth(0)).toContainText('ALFA');\n  await expect(cards.nth(1)).toContainText('BETA');\n\n  await page.locator('[data-nav=\"docs\"]:visible').first().click();\n  await expect(page.locator('#sort-docs')).toHaveValue('code');\n  await expect(page.locator('#sort-docs option:checked')).toHaveText('Código PW · A–Z');\n  const codes = await page.locator('#docs-body .code-cell strong').allTextContents();\n  expect(codes).toEqual(['PW-A-001', 'PW-B-001', 'PW-B-002']);\n\n  await page.locator('[data-nav=\"inspect\"]:visible').first().click();\n  await page.locator('#verification-scope').selectOption('inspection-beta');\n  await page.locator('#pw-search').fill('PW-B-001');\n  await page.locator('#pw-search').press('Enter');\n  await expect(page.locator('.doc-detail .doc-heading h2')).toHaveText('PW-B-001');\n\n  await page.locator('#found-revision').fill('A');\n  await page.locator('#save-verification').click();\n  await expect(page.locator('.doc-detail .doc-heading h2')).toHaveText('PW-B-001');\n  await expect(page.locator('.copies-history')).toContainText('Cópia 2');\n  await expect(page.locator('#next-document')).toBeEnabled();\n\n  await page.locator('#next-document').click();\n  await expect(page.locator('.doc-detail .doc-heading h2')).toHaveText('PW-B-002');\n  await expect(page.locator('#next-document')).toBeDisabled();\n});\n`;
}
write(e2ePath, e2e);

let recoveryTest = read('tests/recovery-ui.test.mjs');
if (!recoveryTest.includes('lixeira deve permanecer aberta após restaurar')) {
  recoveryTest = recoveryTest.replace(
    "assert.match(ui, /await syncNow\\(\\{ announce: false \\}\\)/, 'restauração deve sincronizar antes de criar nova geração');",
    "assert.match(ui, /await syncNow\\(\\{ announce: false \\}\\)/, 'restauração deve sincronizar antes de criar nova geração');\nassert.match(ui, /row\\.remove\\(\\)/, 'lixeira deve permanecer aberta após restaurar e remover apenas a linha recuperada');\nassert.doesNotMatch(ui, /showToast\\(\\`Documento restaurado[\\s\\S]{0,220}modal\\.closeModal\\(\\)/, 'restauração não deve fechar o modal automaticamente');"
  );
  write('tests/recovery-ui.test.mjs', recoveryTest);
}

const migration = `-- Retira metadados e mecanismos relacionais do subsistema de PDF confidencial/E2EE.\n-- O bucket Storage precisa estar fisicamente vazio via Storage API antes desta migration ser aplicada.\n-- Migrações históricas permanecem no repositório como proveniência.\n\ndo $$\nbegin\n  if exists (select 1 from storage.objects where bucket_id = 'docinspector-confidential-pdfs') then\n    raise exception 'docinspector-confidential-pdfs ainda contém objetos; esvazie via Storage API antes da retirada relacional';\n  end if;\nend $$;\n\ndrop policy if exists docinspector_confidential_pdf_delete on storage.objects;\ndrop policy if exists docinspector_confidential_pdf_insert on storage.objects;\ndrop policy if exists docinspector_confidential_pdf_select on storage.objects;\n\ndelete from storage.buckets where id = 'docinspector-confidential-pdfs'\n  and not exists (select 1 from storage.objects where bucket_id = 'docinspector-confidential-pdfs');\n\ndrop trigger if exists docinspector_workspace_members_guard_e2ee_deactivation on public.docinspector_workspace_members;\n\ndrop function if exists public.docinspector_guard_e2ee_member_deactivation() cascade;\ndrop function if exists public.docinspector_block_confidential_upload_during_rotation() cascade;\ndrop function if exists public.docinspector_enforce_confidential_document_limits() cascade;\ndrop function if exists public.docinspector_begin_member_removal_rotation(uuid, uuid, integer, integer, bytea) cascade;\ndrop function if exists public.docinspector_crypto_key_targets(uuid) cascade;\ndrop function if exists public.docinspector_finish_workspace_rotation(uuid, integer, integer) cascade;\ndrop function if exists public.docinspector_initialize_workspace_crypto(uuid, integer, bytea) cascade;\ndrop function if exists public.docinspector_rewrap_confidential_file_key(uuid, uuid, integer, integer, bytea) cascade;\ndrop function if exists public.docinspector_workspace_rotation_status(uuid) cascade;\n\ndrop table if exists public.docinspector_project_documents cascade;\ndrop table if exists public.docinspector_workspace_key_envelopes cascade;\ndrop table if exists public.docinspector_workspace_crypto_keys cascade;\ndrop table if exists public.docinspector_member_key_backups cascade;\ndrop table if exists public.docinspector_member_public_keys cascade;\ndrop table if exists public.docinspector_confidential_pdf_config cascade;\n`;
write('supabase/migrations/20260903101500_retire_confidential_pdf_e2ee.sql', migration);

console.log('A-Z, verification persistence, trash continuity and interaction stability patch applied.');
