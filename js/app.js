import {
  deleteEvidence,
  deleteInspectionBundle,
  getEvidence,
  getInspection,
  listEvidence,
  listInspections,
  replaceAllInspections,
  saveEvidence,
  saveInspection,
  saveInspectionWithEvidenceDeletion
} from './db.js';
import {
  addFieldCopy,
  createId,
  createInspection,
  documentMarkings,
  MARKING,
  RESULT,
  markNotFound,
  metrics,
  normalizeCode,
  removeFieldCopy,
  updateFieldCopy,
  validateInspection
} from './domain.js';
import { buildInspectionExportData, exportInspection, mapRows, readWorkbook, suggestMapping } from './xlsx.js';
import { exportInspectionPdf } from './report.js';
import { exportInspectionWord } from './word.js';
import { codesEquivalent, detectMarkingColors, prepareEvidenceImage, prepareOcrRuntime, recognizeEngineeringDrawing } from './vision.js';
import { escapeHtml, formatDate, icon, openModal, setButtonBusy, showToast } from './ui.js';
import { getInstallState, getStorageReadiness, prepareOfflineDependencies, registerPWA, requestInstall } from './pwa.js';
import {
  bindSyncLifecycle,
  connectWithCode,
  createSyncWorkspace,
  disconnectSync,
  getConnectionCode,
  getSyncConfig,
  getSyncStatus,
  mergeInspection,
  startSync,
  syncNow,
  testSupabaseConnection,
  testConfiguredSyncConnection,
  downloadRemoteEvidence
} from './sync.js';

const APP_VERSION = '0.9.11';
const DOCS_PAGE_SIZE = 50;
const app = document.querySelector('#app');
const state = {
  inspections: [],
  current: null,
  view: 'home',
  previousView: null,
  selectedDoc: null,
  selectedInspectionId: null,
  importRows: null,
  headers: null,
  docsPage: 1,
  scanning: false,
  pwSearchQuery: '',
  docsFilters: {
    text: '',
    system: '',
    inspectionId: '',
    result: '',
    status: '',
    sort: 'code'
  },
  sidebarCollapsed: localStorage.getItem('docinspector-sidebar-collapsed') === '1',
  fieldReadiness: {
    status: 'idle',
    checks: [],
    message: 'Ainda não executado neste aparelho.'
  }
};

async function boot() {
  state.inspections = await listInspections();
  const lastInspectionId = localStorage.getItem('sky17-current');

  if (lastInspectionId) {
    state.current = await getInspection(lastInspectionId) || null;
    if (!state.current) localStorage.removeItem('sky17-current');
  }

  bindSyncLifecycle();
  bindViewportAwareness();
  await startSync().catch(() => {});
  if (getSyncConfig() && navigator.onLine) {
    syncNow({ announce: false }).catch(() => {});
  }

  render();
  await registerPWA(() => showToast('Não foi possível ativar o modo offline.', 'error'));

  window.addEventListener('sky17:install-available', () => {
    if (state.view === 'settings' && state.fieldReadiness.status !== 'running') render();
  });
  window.addEventListener('sky17:installed', () => {
    if (state.view === 'settings' && state.fieldReadiness.status !== 'running') render();
  });
  window.addEventListener('sky17:sync-status', () => updateSyncBadge());
  window.addEventListener('sky17:sync-complete', refreshAfterSync);
}

function render() {
  const views = {
    home: homeView,
    inspect: inspectView,
    docs: docsView,
    'doc-detail': documentPageView,
    settings: settingsView
  };

  const view = views[state.view] || homeView;
  app.innerHTML = shell(view());
  bindCurrentView();
}

function shell(content) {
  const systems = new Set(state.inspections.map(item => item.system).filter(Boolean));
  return `
    <div class="app-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"><img src="assets/icon.svg" alt=""></div>
          <div class="brand-copy">
            <div><span class="brand-doc">Doc</span><span class="brand-inspector">Inspector</span></div>
            <small>INSPEÇÕES TÉCNICAS · v${APP_VERSION}</small>
          </div>
          <button class="sidebar-toggle" id="sidebar-toggle" type="button" aria-label="${state.sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}" title="${state.sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}"><span class="sidebar-toggle-glyph" aria-hidden="true"><span class="sidebar-toggle-panel"></span></span></button>
        </div>
        <nav class="nav" aria-label="Navegação principal">
          ${navButton('home', 'Início')}
          ${navButton('inspect', 'Verificar')}
          ${navButton('docs', 'Documentos')}
          ${navButton('settings', 'Dados e backup')}
        </nav>
        <div class="sidebar-footer">
          <div class="current-inspection">
            <span class="sidebar-kicker">BASE LOCAL</span>
            <strong>${formatInspectionCount(state.inspections.length)}</strong>
            <small>${systems.size} ${systems.size === 1 ? 'sistema' : 'sistemas'} · ${formatDocumentCount(allDocuments().length)}</small>
          </div>
          <div class="sidebar-system">
            ${icon('shield')}
            <span>Dados locais protegidos<br><small>Offline-first</small></span>
          </div>
        </div>
      </aside>
      <main class="main">${content}</main>
      <nav class="mobile-nav" aria-label="Navegação móvel">
        ${navButton('home', 'Início')}
        ${navButton('inspect', 'Verificar')}
        ${navButton('docs', 'Documentos')}
        ${navButton('settings', 'Dados')}
      </nav>
    </div>`;
}

function navButton(view, label) {
  const active = state.view === view ? 'active' : '';
  const current = state.view === view ? 'aria-current="page"' : '';
  return `
    <button data-nav="${view}" class="${active}" type="button" ${current}>
      <span class="nav-icon">${icon(view)}</span>
      <span>${label}</span>
    </button>`;
}

function topbar(title, subtitle, action = '') {
  const backButton = state.view !== 'home'
    ? `<button class="page-back-button" id="page-back" type="button" aria-label="Voltar à página anterior" title="Voltar">
        ${icon('chevron', 'icon page-back-icon')}
      </button>`
    : '';

  return `
    <header class="topbar">
      <div class="topbar-leading">
        ${backButton}
        <div class="topbar-copy">
          <h1>${title}</h1>
          <div class="subtitle">${subtitle}</div>
        </div>
      </div>
      <div class="topbar-actions">
        ${syncBadgeHtml()}
        ${action}
      </div>
    </header>`;
}

function syncBadgeHtml() {
  const status = getSyncStatus();
  return `<button class="sync-badge ${status.state}" id="sync-badge" type="button" title="Abrir configurações de sincronização">
    <span class="sync-dot" aria-hidden="true"></span>
    <span data-sync-label>${escapeHtml(status.label)}</span>
  </button>`;
}

function updateSyncBadge() {
  const badge = document.querySelector('#sync-badge');
  if (!badge) return;
  const status = getSyncStatus();
  badge.className = `sync-badge ${status.state}`;
  const label = badge.querySelector('[data-sync-label]');
  if (label) label.textContent = status.label;
}

function fieldReadinessHtml() {
  const report = state.fieldReadiness || { status: 'idle', checks: [], message: 'Ainda não executado neste aparelho.' };
  if (report.status === 'idle') return escapeHtml(report.message);
  if (report.status === 'running') {
    const partial = (report.checks || []).map(item =>
      `<li class="${item.ok ? (item.warning ? 'warning' : 'ok') : 'fail'}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.detail)}</small></li>`
    ).join('');
    return `<strong>Diagnóstico em andamento…</strong><small>${escapeHtml(report.message || 'Preparando o aparelho.')}</small>${partial ? `<ul>${partial}</ul>` : ''}`;
  }
  if (report.status === 'error' && !report.checks?.length) return escapeHtml(report.message || 'O diagnóstico não pôde ser concluído.');

  const title = report.status === 'error'
    ? 'Aparelho ainda não está pronto para campo.'
    : report.status === 'warning'
      ? 'Pronto com observações.'
      : 'Aparelho preparado para campo.';

  return `<strong>${title}</strong>
    <ul>${(report.checks || []).map(item =>
      `<li class="${item.ok ? (item.warning ? 'warning' : 'ok') : 'fail'}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.detail)}</small></li>`
    ).join('')}</ul>`;
}

function paintFieldReadiness() {
  const target = document.querySelector('#field-readiness-result');
  if (!target) return;
  const status = state.fieldReadiness?.status || 'idle';
  target.className = `field-readiness-result ${['success','warning','error'].includes(status) ? status : ''}`.trim();
  target.innerHTML = fieldReadinessHtml();
}

function refreshSettingsStatusInPlace() {
  if (state.view !== 'settings') return false;
  updateSyncBadge();
  const syncStatus = getSyncStatus();
  const status = document.querySelector('#settings-sync-status');
  const last = document.querySelector('#settings-sync-last');
  if (status) status.textContent = syncStatus.label;
  if (last) last.textContent = syncStatus.lastSyncAt ? formatDate(syncStatus.lastSyncAt) : 'Ainda não concluída';
  paintFieldReadiness();
  return true;
}

async function refreshAfterSync() {
  captureLiveUiState();
  try {
    const selectedInspectionId = state.selectedInspectionId || state.current?.id;
    const selectedDocumentId = state.selectedDoc?.id;
    state.inspections = await listInspections();

    if (selectedInspectionId && selectedDocumentId) {
      const context = documentContext(selectedInspectionId, selectedDocumentId);
      state.current = context?.inspection || null;
      state.selectedDoc = context?.document || null;
      state.selectedInspectionId = context?.inspection?.id || null;
    } else if (state.current?.id) {
      state.current = state.inspections.find(item => item.id === state.current.id) || null;
    }

    if (state.view === 'inspect') {
      const dashboardRoot = document.querySelector('#global-dashboard');
      if (dashboardRoot) dashboardRoot.innerHTML = dashboard(allDocuments(), 'Resumo de todas as inspeções');
      updateSearchSuggestions();
      const detail = document.querySelector('.doc-detail');
      if (detail && !hasActiveVerificationDraft()) detail.innerHTML = documentDetailView();
      bindInspectionActions({ preserveFocus: true });
      return;
    }

    if (state.view === 'docs') {
      refreshDocumentFilterOptions();
      refreshRows();
      return;
    }

    if (state.view === 'doc-detail' && state.selectedDoc) {
      render();
      return;
    }

    if (state.view === 'settings') {
      refreshSettingsStatusInPlace();
      return;
    }

    render();
  } catch {
    // A próxima sincronização tentará novamente; não interrompe o uso local.
  }
}

function formatDocumentCount(total) {
  return `${total} ${total === 1 ? 'documento' : 'documentos'}`;
}

function formatInspectionCount(total) {
  return `${total} ${total === 1 ? 'inspeção' : 'inspeções'}`;
}

function allDocumentContexts() {
  return state.inspections.flatMap(inspection =>
    (inspection.documents || []).map(document => ({ inspection, document }))
  );
}

function allDocuments() {
  return allDocumentContexts().map(item => item.document);
}

function documentContext(inspectionId, documentId) {
  const inspection = state.inspections.find(item => item.id === inspectionId);
  const document = inspection?.documents?.find(item => item.id === documentId);
  return inspection && document ? { inspection, document } : null;
}

function contextsForCode(value) {
  const code = normalizeCode(value);
  if (!code) return [];
  return allDocumentContexts().filter(({ document }) => normalizeCode(document.code) === code);
}

function equivalentContextsForCode(value) {
  return allDocumentContexts().filter(({ document }) => codesEquivalent(document.code, value));
}

function selectedContext() {
  if (!state.selectedDoc) return null;
  const inspectionId = state.selectedInspectionId || state.current?.id;
  return documentContext(inspectionId, state.selectedDoc.id) || (state.current ? { inspection: state.current, document: state.selectedDoc } : null);
}

function selectDocumentContext(context, { renderView = true } = {}) {
  if (!context) return false;
  state.current = context.inspection;
  state.selectedInspectionId = context.inspection.id;
  state.selectedDoc = context.document;
  localStorage.setItem('sky17-current', context.inspection.id);
  if (renderView) render();
  return true;
}

function captureLiveUiState() {
  const pw = document.querySelector('#pw-search');
  if (pw) state.pwSearchQuery = pw.value;
  const text = document.querySelector('#filter-text');
  if (text) state.docsFilters.text = text.value;
  const system = document.querySelector('#filter-system');
  if (system) state.docsFilters.system = system.value;
  const inspectionFilter = document.querySelector('#filter-inspection');
  if (inspectionFilter) state.docsFilters.inspectionId = inspectionFilter.value;
  const result = document.querySelector('#filter-result');
  if (result) state.docsFilters.result = result.value;
  const status = document.querySelector('#filter-status');
  if (status) state.docsFilters.status = status.value;
  const sort = document.querySelector('#sort-docs');
  if (sort) state.docsFilters.sort = sort.value;
}

function hasActiveVerificationDraft() {
  if (state.view !== 'inspect' || !state.selectedDoc) return false;
  const detail = document.querySelector('.doc-detail');
  if (!detail) return false;
  const revision = detail.querySelector('#found-revision')?.value?.trim() || '';
  const comment = detail.querySelector('#comment')?.value?.trim() || '';
  const markings = detail.querySelectorAll('input[name="marking"]:checked').length;
  const focusInside = detail.contains(document.activeElement);
  return Boolean(revision || comment || markings || focusInside);
}

function bindViewportAwareness() {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const update = () => {
    const keyboardLikelyOpen = viewport.height < window.innerHeight * 0.72;
    document.body.classList.toggle('keyboard-open', keyboardLikelyOpen);
  };

  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  update();
}

function homeView() {
  const contexts = allDocumentContexts();
  const systems = [...new Set(state.inspections.map(item => item.system).filter(Boolean))];
  const syncStatus = getSyncStatus();
  const inspectionList = state.inspections.map(inspection => {
    const data = metrics(inspection.documents || []);
    return `
      <article class="card inspection-item inspection-item-clickable" data-open-inspection="${escapeHtml(inspection.id)}" role="button" tabindex="0" aria-label="Abrir documentos da inspeção ${escapeHtml(inspection.name || inspection.project)}">
        <div class="inspection-summary">
          <span class="inspection-icon" aria-hidden="true">${icon('docs')}</span>
          <div>
            <span class="section-kicker">SISTEMA</span>
            <h3 class="inspection-system-title">${escapeHtml(inspection.system || 'Sem sistema')}</h3>
            <div class="inspection-list-name">${escapeHtml(inspection.name || inspection.project)}</div>
            <div class="subtitle">${escapeHtml(inspection.responsible)}${inspection.location ? ` · ${escapeHtml(inspection.location)}` : ''}</div>
            <div class="inspection-mini-stats">
              <span>${formatDocumentCount(data.total)}</span>
              <span>${data.verified} verificados</span>
              <span>${data.pending} pendentes</span>
            </div>
          </div>
        </div>
        <div class="inspection-actions">
          <button class="btn" data-view-inspection="${escapeHtml(inspection.id)}" type="button">Ver documentos</button>
          <button class="btn" data-edit-inspection="${escapeHtml(inspection.id)}" type="button">${icon('edit')}<span>Editar</span></button>
          <button class="btn" data-export-inspection="${escapeHtml(inspection.id)}" type="button">Exportar</button>
          <button class="btn btn-danger" data-delete="${escapeHtml(inspection.id)}" type="button">Excluir</button>
        </div>
      </article>`;
  }).join('');

  return `
    ${topbar(
      'Início',
      'Gerencie listas de inspeção independentes',
      '<button class="btn btn-gold" id="new-verification" type="button">' + icon('camera') + '<span>Nova verificação</span></button>'
    )}
    <section class="home-summary" aria-label="Resumo da base">
      <div class="card home-stat"><span>Inspeções</span><strong>${state.inspections.length}</strong><small>listas independentes</small></div>
      <div class="card home-stat"><span>Sistemas</span><strong>${systems.length}</strong><small>sistemas cadastrados</small></div>
      <div class="card home-stat"><span>Documentos</span><strong>${contexts.length}</strong><small>em todas as listas</small></div>
      <div class="card home-stat"><span>Sincronização</span><strong class="home-sync-value">${escapeHtml(syncStatus.label)}</strong><small>${getSyncConfig() ? 'Supabase configurado' : 'somente neste aparelho'}</small></div>
    </section>
    <section class="new-inspection-callout card">
      <div>
        <span class="section-kicker">NOVA LISTA</span>
        <h2>Adicionar uma nova inspeção</h2>
        <p class="subtitle">Cada planilha importada permanece isolada em sua própria inspeção. Projeto, sistema, resultados e cópias não são misturados com outras listas.</p>
      </div>
      <button class="btn btn-gold" id="new-inspection-hero" type="button">${icon('plus')}<span>Nova inspeção</span></button>
    </section>
    <div class="section-title home-list-title">
      <div><span class="section-kicker">INSPEÇÕES CRIADAS</span><h2>Listas de inspeção</h2></div>
      <span class="subtitle">${formatInspectionCount(state.inspections.length)}</span>
    </div>
    <div class="list inspection-library">
      ${inspectionList || '<div class="card empty">Nenhuma inspeção criada. Use “Nova inspeção” para importar a primeira lista.</div>'}
    </div>`;
}

function dashboard(source, ariaLabel = 'Resumo') {
  const documents = Array.isArray(source) ? source : (source?.documents || []);
  const data = metrics(documents);
  const cards = [
    ['Total de documentos', data.total, 'gold', 'total'],
    ['Verificados', data.verified, 'verified', 'verified'],
    ['Conformes', data.conforming, 'green', 'conforming'],
    ['Não conformes', data.nonconforming, 'red', 'nonconforming'],
    ['Não encontrados', data.notFound, 'amber', 'notfound'],
    ['Pendentes', data.pending, 'pending', 'pending']
  ];

  return `
    <div class="grid cards" aria-label="${escapeHtml(ariaLabel)}">
      ${cards.map(([label, value, className, iconName]) => `
        <div class="card metric ${className}">
          <div class="metric-head"><span>${label}</span><span class="metric-icon" aria-hidden="true">${icon(iconName)}</span></div>
          <strong>${value}</strong>
        </div>`).join('')}
    </div>`;
}

function requireCurrent() {
  return `
    <div class="card empty">
      <div>
        <h2>Nenhuma inspeção aberta</h2>
        <p>Abra ou crie uma inspeção na tela inicial.</p>
        <button class="btn btn-primary" data-nav="home" type="button">Ir para início</button>
      </div>
    </div>`;
}

function inspectView() {
  const hasDocuments = allDocuments().length > 0;
  return `
    ${topbar('Verificação em campo', 'Localize e verifique documentos de qualquer inspeção ou sistema')}
    ${hasDocuments ? `
    <div class="verify-layout global-verify-layout">
      <section class="card locate-card">
        <div class="section-title"><div><span class="section-kicker">BUSCA GLOBAL</span><h2>Localizar documento</h2></div></div>
        <p class="subtitle">Pesquise por Código PW ou por qualquer trecho da descrição. Projeto e sistema aparecem nas sugestões para evitar selecionar a lista errada.</p>
        <div class="search-box global-search-box">
          <input id="pw-search" value="${escapeHtml(state.pwSearchQuery)}" placeholder="Ex.: DE-17... ou trecho da descrição" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="search" aria-label="Pesquisar por Código PW ou descrição em todas as inspeções" aria-controls="pw-suggestions" aria-autocomplete="list">
          <button class="icon-button search-clear-button" id="clear-pw-search" type="button" aria-label="Limpar busca" title="Limpar busca">${icon('close')}</button>
          <button class="btn btn-gold" id="find-pw" type="button">${icon('search')}<span>Localizar</span></button>
        </div>
        <div id="pw-suggestions" class="search-suggestions" aria-live="polite">${searchSuggestionsHtml(state.pwSearchQuery)}</div>
        <div class="scan-actions">
          <input id="camera-input" type="file" accept="image/*" capture="environment" hidden>
          <button class="btn btn-camera" id="scan-document" type="button">${icon('camera')}<span>Registrar por foto</span></button>
          <span class="field-help">A câmera consulta todas as listas. Se o mesmo PW existir em mais de uma inspeção, o registro não é escolhido automaticamente.</span>
        </div>
      </section>
      <section class="card doc-detail">${documentDetailView()}</section>
    </div>` : `
      <div class="card empty"><div><h2>Nenhum documento disponível</h2><p>Crie uma inspeção e importe uma planilha para iniciar a verificação.</p><button class="btn btn-primary" data-nav="home" type="button">Ir para início</button></div></div>`}`;
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function documentSearchMatches(query, limit = 10) {
  const raw = String(query ?? '').trim();
  if (raw.length < 2) return [];

  const term = normalizeSearchText(raw);
  const codeTerm = normalizeCode(raw);
  const ranked = [];

  for (const context of allDocumentContexts()) {
    const { document, inspection } = context;
    const code = normalizeCode(document.code);
    const description = normalizeSearchText(document.description);
    const project = normalizeSearchText(inspection.project);
    const system = normalizeSearchText(inspection.system);
    let score = 0;

    if (code === codeTerm) score = 120;
    else if (code.startsWith(codeTerm)) score = 90;
    else if (code.includes(codeTerm)) score = 75;
    else if (description.startsWith(term)) score = 60;
    else if (description.includes(term)) score = 50;
    else if (system.includes(term) || project.includes(term)) score = 20;

    if (score) ranked.push({ context, score });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.context.document.code.localeCompare(b.context.document.code, 'pt-BR'))
    .slice(0, limit)
    .map(item => item.context);
}

function searchSuggestionsHtml(query) {
  const raw = String(query ?? '').trim();
  if (!raw) return '<span class="search-hint">Pesquise por parte do Código PW ou por palavras da descrição.</span>';
  if (raw.length < 2) return '<span class="search-hint">Digite pelo menos 2 caracteres para ver sugestões.</span>';

  const matches = documentSearchMatches(raw);
  if (!matches.length) return '<div class="search-no-results">Nenhum documento correspondente encontrado em nenhuma inspeção.</div>';

  return `<div class="search-suggestion-list" role="listbox" aria-label="Documentos sugeridos">${matches.map(({ document, inspection }) => `
    <button class="search-suggestion" data-search-doc="${escapeHtml(document.id)}" data-search-inspection="${escapeHtml(inspection.id)}" type="button" role="option">
      <span class="search-suggestion-code">${escapeHtml(document.code)}</span>
      <span class="search-suggestion-description">${escapeHtml(document.description || 'Sem descrição')}</span>
      <span class="search-suggestion-origin">${escapeHtml(inspection.system)} · ${escapeHtml(inspection.project)}</span>
      <span class="search-suggestion-meta">Rev. ${escapeHtml(document.expectedRevision || '—')} · ${escapeHtml(document.status || 'Sem status')}</span>
    </button>`).join('')}</div>`;
}

function updateSearchSuggestions() {
  const container = document.querySelector('#pw-suggestions');
  if (!container) return;
  container.innerHTML = searchSuggestionsHtml(state.pwSearchQuery);
  bindSearchSuggestionActions(container);
}

function selectSearchDocument(documentId, inspectionId) {
  const context = documentContext(inspectionId, documentId);
  if (!context) return;
  state.pwSearchQuery = context.document.code;
  selectDocumentContext(context, { renderView: false });
  render();
  requestAnimationFrame(() => globalThis.document.querySelector('#found-revision')?.focus());
}

function bindSearchSuggestionActions(root = document) {
  root.querySelectorAll('[data-search-doc]').forEach(button => {
    button.addEventListener('click', () => selectSearchDocument(button.dataset.searchDoc, button.dataset.searchInspection));
  });
}

function markingOptions(selected = []) {
  const selectedSet = new Set(selected);
  return Object.values(MARKING).map(marking => `
    <label class="marking-option marking-${marking.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}">
      <input type="checkbox" name="marking" value="${escapeHtml(marking)}" ${selectedSet.has(marking) ? 'checked' : ''}>
      <span class="marking-dot" aria-hidden="true"></span>
      <span>${escapeHtml(marking)}</span>
    </label>`).join('');
}

function copiesHistory(document) {
  const copies = document.fieldCopies || [];
  if (!copies.length) return '<div class="copies-empty">Nenhuma cópia confirmada em campo.</div>';

  return `<div class="copies-list">${copies.map(copy => `
    <article class="copy-card">
      <div class="copy-card-head">
        <div><strong>Cópia ${copy.sequence}</strong><small>${formatDate(copy.capturedAt)} · ${copy.source === 'camera' ? 'Foto' : copy.source === 'legacy' ? 'Registro anterior' : 'Manual'}</small></div>
        <div class="copy-card-actions">
          <span class="revision-chip">Rev. ${escapeHtml(copy.foundRevision)}</span>
          <button class="icon-button" data-copy-edit="${escapeHtml(copy.id)}" type="button" aria-label="Editar cópia ${copy.sequence}" title="Editar cópia">${icon('edit')}</button>
          <button class="icon-button copy-delete" data-copy-delete="${escapeHtml(copy.id)}" type="button" aria-label="Excluir cópia ${copy.sequence}">${icon('trash')}</button>
        </div>
      </div>
      ${copy.markings?.length ? `<div class="marking-tags">${copy.markings.map(marking => `<span class="marking-tag">${escapeHtml(marking)}</span>`).join('')}</div>` : '<small class="muted-copy">Sem marcações registradas.</small>'}
      ${copy.comment ? `<p class="copy-comment">${escapeHtml(copy.comment)}</p>` : ''}
      ${(copy.evidenceId || copy.evidencePath) ? `<button class="evidence-link" data-view-copy="${escapeHtml(copy.id)}" type="button">${icon('image')} ${copy.evidencePath ? 'Ver foto sincronizada' : 'Ver foto deste aparelho'}</button>` : ''}
      ${copy.evidencePath ? '<span class="evidence-sync-badge">Foto sincronizada</span>' : copy.evidenceId ? '<span class="evidence-sync-badge local">Foto aguardando sincronização</span>' : copy.evidenceUnavailableAt ? '<span class="evidence-sync-badge unavailable">Foto original indisponível</span>' : ''}
    </article>`).join('')}</div>`;
}

function documentDetailView() {
  const context = selectedContext();
  const document = context?.document;
  const inspection = context?.inspection;
  if (!document || !inspection) {
    return `<div class="empty"><div><h3>Localize um documento</h3><p>Os dados da lista de origem, revisão e cópias encontradas aparecerão aqui.</p></div></div>`;
  }

  const resultClass = document.result.replaceAll(' ', '-');
  const copyCount = document.fieldCopies?.length || 0;
  const markings = documentMarkings(document);
  const hasNext = (inspection.documents || []).length > 1;
  return `
    <div>
      <div class="doc-heading">
        <div><span class="doc-kicker">${escapeHtml(inspection.system)} · ${escapeHtml(inspection.project)}</span><h2>${escapeHtml(document.code)}</h2></div>
        <div class="doc-heading-actions">
          <div class="pill ${resultClass}">${escapeHtml(document.result)}</div>
          <button class="icon-button next-document-button" id="next-document" type="button" ${hasNext ? '' : 'disabled'} aria-label="Próximo documento da lista" title="Próximo documento">${icon('chevron')}</button>
        </div>
      </div>
      <p class="doc-description">${escapeHtml(document.description)}</p>
      <div class="document-origin-strip">
        <div><span>Projeto</span><strong>${escapeHtml(inspection.project)}</strong></div>
        <div><span>Sistema</span><strong>${escapeHtml(inspection.system)}</strong></div>
        <div><span>Responsável</span><strong>${escapeHtml(inspection.responsible)}</strong></div>
      </div>
      <div class="document-summary-strip">
        <div><span>Revisão esperada</span><strong>${escapeHtml(document.expectedRevision) || '—'}</strong></div>
        <div><span>Cópias confirmadas</span><strong>${copyCount}</strong></div>
        <div><span>Marcações</span><strong>${markings.length ? markings.join(', ') : 'Nenhuma'}</strong></div>
      </div>
      <section class="new-copy-panel">
        <div class="section-title compact-title"><div><span class="section-kicker">NOVO REGISTRO</span><h3>Registrar revisão encontrada</h3></div></div>
        <div class="form-grid">
          <div class="field"><label for="doc-status">Status da lista</label><input id="doc-status" disabled value="${escapeHtml(document.status)}"></div>
          <div class="field"><label for="found-revision">Revisão encontrada</label><input id="found-revision" value="" placeholder="Ex.: A, B, C, 01" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done"></div>
          <div class="field full copy-quantity-field"><label for="copy-quantity">Quantidade de cópias desta revisão</label><div class="quantity-control"><button class="quantity-btn" data-copy-quantity-step="-1" type="button" aria-label="Diminuir quantidade">−</button><input id="copy-quantity" type="number" min="1" max="9999" step="1" value="1" inputmode="numeric"><button class="quantity-btn" data-copy-quantity-step="1" type="button" aria-label="Aumentar quantidade">+</button></div><small class="field-help">Registre em uma única ação quantas cópias físicas da mesma revisão foram encontradas.</small></div>
          <div class="field full"><label>Marcações observadas</label><div class="marking-grid">${markingOptions()}</div><small class="field-help">Selecione uma ou mais cores quando houver marcações no projeto.</small></div>
          <div class="field full"><label for="comment">Comentário (opcional)</label><textarea id="comment" rows="3" placeholder="Ex.: marcação amarela no quadro de revisão…"></textarea></div>
        </div>
        <div class="actions">${copyCount === 0 ? '<button class="btn" id="mark-not-found" type="button">Não encontrado em campo</button>' : ''}<button class="btn btn-primary" id="save-verification" type="button">Registrar cópias</button></div>
      </section>
      <section class="copies-history"><div class="section-title compact-title"><div><span class="section-kicker">HISTÓRICO</span><h3>Cópias deste documento</h3></div></div>${copiesHistory(document)}</section>
    </div>`;
}

function documentsDashboardSource() {
  const selectedInspection = state.docsFilters.inspectionId ? state.inspections.find(item => item.id === state.docsFilters.inspectionId) : null;
  return selectedInspection ? (selectedInspection.documents || []) : allDocuments();
}

function refreshDocumentsDashboard() {
  if (state.view !== 'docs') return;
  const selectedInspection = state.docsFilters.inspectionId ? state.inspections.find(item => item.id === state.docsFilters.inspectionId) : null;
  const title = document.querySelector('#documents-dashboard-title');
  const subtitle = document.querySelector('#documents-dashboard-subtitle');
  const content = document.querySelector('#documents-dashboard-content');
  if (title) title.textContent = selectedInspection ? (selectedInspection.system || 'Sem sistema') : 'Todos os documentos';
  if (subtitle) subtitle.textContent = selectedInspection ? (selectedInspection.name || selectedInspection.project) : 'Indicadores consolidados de todas as listas de inspeção.';
  if (content) content.innerHTML = dashboard(documentsDashboardSource(), selectedInspection ? 'Resumo da inspeção selecionada' : 'Resumo de todas as inspeções');
}

function docsView() {
  const contexts = allDocumentContexts();
  const systems = [...new Set(state.inspections.map(item => item.system).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const statuses = [...new Set(contexts.map(({ document }) => document.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const selectedInspection = state.docsFilters.inspectionId ? state.inspections.find(item => item.id === state.docsFilters.inspectionId) : null;
  const documents = getFilteredDocuments({ fromState: true });
  const pages = Math.max(1, Math.ceil(documents.length / DOCS_PAGE_SIZE));
  state.docsPage = Math.min(Math.max(1, state.docsPage), pages);
  const start = (state.docsPage - 1) * DOCS_PAGE_SIZE;
  const visible = documents.slice(start, start + DOCS_PAGE_SIZE);
  const title = selectedInspection ? `Documentos - ${selectedInspection.name || selectedInspection.project}` : 'Documentos';
  const subtitle = selectedInspection
    ? `${formatDocumentCount(selectedInspection.documents?.length || 0)} nesta lista · ${escapeHtml(selectedInspection.system || 'Sem sistema')}`
    : `${formatDocumentCount(contexts.length)} em ${formatInspectionCount(state.inspections.length)}`;

  const exportAction = selectedInspection
    ? `<button class="btn" id="export-selected-inspection" type="button">${icon('download')}<span>Exportar</span></button>`
    : '';

  return `
    ${topbar(title, subtitle, exportAction)}
    <section id="documents-dashboard" class="dashboard-block documents-dashboard">
      <div class="section-title dashboard-title"><div><span class="section-kicker">INDICADORES</span><h2 id="documents-dashboard-title">${escapeHtml(selectedInspection ? (selectedInspection.system || 'Sem sistema') : 'Todos os documentos')}</h2><span id="documents-dashboard-subtitle" class="subtitle">${escapeHtml(selectedInspection ? (selectedInspection.name || selectedInspection.project) : 'Indicadores consolidados de todas as listas de inspeção.')}</span></div></div>
      <div id="documents-dashboard-content">${dashboard(documentsDashboardSource(), selectedInspection ? 'Resumo da inspeção selecionada' : 'Resumo de todas as inspeções')}</div>
    </section>
    <div class="spacer small"></div>
    <section class="card documents-catalog">
      <div class="section-title"><div><span class="section-kicker">${selectedInspection ? 'LISTA SELECIONADA' : 'CATÁLOGO GLOBAL'}</span><h2>${selectedInspection ? escapeHtml(selectedInspection.system || 'Sem sistema') : 'Todos os documentos'}</h2></div><span class="subtitle">${selectedInspection ? escapeHtml(selectedInspection.name || selectedInspection.project) : 'Use Sistema ou Lista para visualizar uma área específica.'}</span></div>
      <div class="toolbar documents-toolbar">
        <input id="filter-text" value="${escapeHtml(state.docsFilters.text)}" placeholder="Pesquisar Código PW ou descrição" aria-label="Pesquisar documentos" autocomplete="off">
        <select id="filter-inspection" aria-label="Filtrar por lista de inspeção"><option value="">Todas as listas</option>${state.inspections.map(item => `<option value="${escapeHtml(item.id)}" ${state.docsFilters.inspectionId === item.id ? 'selected' : ''}>${escapeHtml(item.system || 'Sem sistema')} · ${escapeHtml(item.name || item.project)}</option>`).join('')}</select>
        <select id="filter-system" aria-label="Filtrar por sistema"><option value="">Todos os sistemas</option>${systems.map(value => `<option value="${escapeHtml(value)}" ${state.docsFilters.system === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select>
        <select id="filter-result" aria-label="Filtrar por resultado"><option value="">Todos os resultados</option>${Object.values(RESULT).map(value => `<option value="${escapeHtml(value)}" ${state.docsFilters.result === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select>
        <select id="filter-status" aria-label="Filtrar por status"><option value="">Todos os status</option>${statuses.map(value => `<option value="${escapeHtml(value)}" ${state.docsFilters.status === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select>
        <select id="sort-docs" aria-label="Ordenar documentos"><option value="code" ${state.docsFilters.sort === 'code' ? 'selected' : ''}>Ordenar por código</option><option value="description" ${state.docsFilters.sort === 'description' ? 'selected' : ''}>Ordenar por descrição</option><option value="system" ${state.docsFilters.sort === 'system' ? 'selected' : ''}>Ordenar por sistema</option></select>
        <button class="btn btn-clear-filters" id="clear-doc-filters" type="button">${icon('close')}<span>Limpar filtros</span></button>
      </div>
      <div class="table-wrap compact-doc-table">
        <table><thead><tr><th>Código PW</th><th>Descrição</th><th aria-label="Ações">Ações</th></tr></thead><tbody id="docs-body">${rowsHtml(visible)}</tbody></table>
      </div>
      <div id="docs-pagination">${paginationHtml(documents.length, state.docsPage)}</div>
    </section>`;
}

function rowsHtml(contexts) {
  if (!contexts.length) return '<tr class="no-results"><td colspan="3">Nenhum documento encontrado com os filtros atuais.</td></tr>';
  return contexts.map(({ document, inspection }) => `
    <tr class="document-row-clickable" data-doc-row="${escapeHtml(document.id)}" data-inspection-row="${escapeHtml(inspection.id)}" tabindex="0" aria-label="Abrir detalhes de ${escapeHtml(document.code)}">
      <td class="code-cell" data-label="Código PW"><strong>${escapeHtml(document.code)}</strong><small class="row-origin">${escapeHtml(inspection.system)}</small></td>
      <td class="document-description-cell" data-label="Descrição"><span class="document-description-text">${escapeHtml(document.description || '—')}</span><small class="row-origin">${escapeHtml(inspection.project)}</small></td>
      <td class="details-cell" data-label="Ações"><button class="btn btn-compact" data-doc-details="${escapeHtml(document.id)}" data-inspection-details="${escapeHtml(inspection.id)}" type="button">Mais detalhes</button></td>
    </tr>`).join('');
}

function paginationHtml(total, page) {
  const pages = Math.max(1, Math.ceil(total / DOCS_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  if (total <= DOCS_PAGE_SIZE) {
    return `<div class="pagination-summary">${formatDocumentCount(total)}</div>`;
  }

  return `
    <div class="pagination" aria-label="Paginação dos documentos">
      <span class="pagination-summary">${formatDocumentCount(total)} · Página ${current} de ${pages}</span>
      <div class="pagination-actions">
        <button class="btn" id="docs-prev" type="button" ${current === 1 ? 'disabled' : ''}>Anterior</button>
        <button class="btn" id="docs-next" type="button" ${current === pages ? 'disabled' : ''}>Próxima</button>
      </div>
    </div>`;
}

function documentPageView() {
  const context = selectedContext();
  if (!context) return `${topbar('Detalhes do documento', 'Documento não encontrado')}<div class="card empty"><div><p>O documento selecionado não está mais disponível.</p><button class="btn" data-nav="docs" type="button">Voltar aos documentos</button></div></div>`;
  const { inspection, document } = context;
  const markings = documentMarkings(document);
  const resultClass = document.result.replaceAll(' ', '-');
  return `
    ${topbar('Detalhes do documento', `${escapeHtml(inspection.system)} · ${escapeHtml(inspection.project)}`)}
    <section class="card document-page">
      <div class="doc-heading"><div><span class="doc-kicker">CÓDIGO PW</span><h2>${escapeHtml(document.code)}</h2></div><span class="pill ${resultClass}">${escapeHtml(document.result)}</span></div>
      <p class="doc-description large">${escapeHtml(document.description || 'Sem descrição')}</p>
      <div class="detail-grid">
        <div><span>Projeto</span><strong>${escapeHtml(inspection.project)}</strong></div>
        <div><span>Sistema</span><strong>${escapeHtml(inspection.system)}</strong></div>
        <div><span>Responsável</span><strong>${escapeHtml(inspection.responsible)}</strong></div>
        <div><span>Local</span><strong>${escapeHtml(inspection.location || '—')}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(document.status || '—')}</strong></div>
        <div><span>Revisão esperada</span><strong>${escapeHtml(document.expectedRevision || '—')}</strong></div>
        <div><span>Revisão encontrada</span><strong>${escapeHtml(document.foundRevision || '—')}</strong></div>
        <div><span>Cópias</span><strong>${document.copyCount || 0}</strong></div>
        <div><span>Marcações</span><strong>${markings.length ? markings.join(', ') : 'Nenhuma'}</strong></div>
        <div><span>Última verificação</span><strong>${formatDate(document.verifiedAt)}</strong></div>
      </div>
      ${document.comment ? `<div class="detail-comment"><span>Comentário consolidado</span><p>${escapeHtml(document.comment)}</p></div>` : ''}
      <div class="section-title compact-title"><div><span class="section-kicker">HISTÓRICO</span><h3>Cópias de campo</h3></div></div>
      ${copiesHistory(document)}
      <div class="actions detail-actions"><button class="btn btn-primary" id="verify-this-document" type="button">Verificar este documento</button><button class="btn" data-nav="docs" type="button">Voltar aos documentos</button></div>
    </section>`;
}

function settingsView() {
  const installState = getInstallState();
  const installContent = installState.installed
    ? '<div class="install-status success">O DocInspector já está aberto como aplicativo instalado.</div>'
    : installState.ios
      ? `<p class="subtitle">No iPhone ou iPad, abra o DocInspector no Safari e use <strong>Compartilhar → Adicionar à Tela de Início</strong>.</p>
         <button class="btn" id="install-app" type="button">${icon('install')}<span>Ver instrução</span></button>`
      : `<p class="subtitle">Instale o DocInspector para abrir em uma janela própria e facilitar o uso em campo.</p>
         <button class="btn btn-primary" id="install-app" type="button" ${installState.canPrompt ? '' : 'disabled'}>
           ${icon('install')}<span>${installState.canPrompt ? 'Instalar aplicativo' : 'Instalação disponível após carregamento'}</span>
         </button>`;

  const syncConfig = getSyncConfig();
  const syncStatus = getSyncStatus();
  const syncContent = syncConfig
    ? `<div class="sync-panel">
        <div class="install-status success">Conectado ao espaço <strong>${escapeHtml(syncConfig.workspaceName || 'DocInspector')}</strong>.</div>
        <div class="sync-meta">
          <span>Status</span><strong id="settings-sync-status">${escapeHtml(syncStatus.label)}</strong>
          <span>Última sincronização</span><strong id="settings-sync-last">${syncStatus.lastSyncAt ? formatDate(syncStatus.lastSyncAt) : 'Ainda não concluída'}</strong>
        </div>
        <p class="subtitle">Use o código de conexão para vincular outro computador ou celular ao mesmo conjunto de inspeções.</p>
        <div class="actions sync-actions">
          <button class="btn" id="test-current-sync" type="button">Testar conexão</button>
          <button class="btn btn-primary" id="sync-now" type="button">${icon('sync')}<span>Sincronizar agora</span></button>
          <button class="btn" id="copy-sync-code" type="button">${icon('copy')}<span>Copiar código</span></button>
          <button class="btn btn-danger" id="disconnect-sync" type="button">Desconectar aparelho</button>
        </div>
      </div>`
    : `<p class="subtitle">Conecte o DocInspector ao Supabase para manter as mesmas inspeções atualizadas entre computador, iPhone e outros aparelhos.</p>
       <button class="btn btn-primary" id="configure-sync" type="button">${icon('sync')}<span>Configurar sincronização</span></button>`;

  return `
    ${topbar('Dados e backup', 'Proteja e sincronize suas inspeções')}
    <div class="settings-grid">
      <section class="card settings-wide">
        <h2>Sincronização Supabase</h2>
        ${syncContent}
      </section>
      <section class="card">
        <h2>Instalação PWA</h2>
        ${installContent}
      </section>
      <section class="card">
        <h2>Backup</h2>
        <p class="subtitle">O Supabase mantém a cópia operacional sincronizada automaticamente quando configurado. O backup JSON é uma camada adicional de recuperação e portabilidade; fotos ainda pendentes de envio não são incorporadas ao arquivo.</p>
        <button class="btn btn-primary" id="backup" type="button">Gerar backup</button>
      </section>
      <section class="card">
        <h2>Restauração</h2>
        <p class="subtitle">A restauração substituirá os dados locais atuais.</p>
        <input type="file" id="restore-file" accept="application/json,.json" hidden>
        <button class="btn" id="restore" type="button">Selecionar backup</button>
      </section>
      <section class="card settings-wide field-readiness-card">
        <div class="section-title compact-title"><div><span class="section-kicker">PRÉ-CAMPO</span><h2>Diagnóstico do dispositivo</h2></div></div>
        <p class="subtitle">Valide armazenamento local, PWA, bibliotecas offline, OCR, evidências e, quando configurado, a conexão com o Supabase antes de sair para campo.</p>
        <div id="field-readiness-result" class="field-readiness-result" aria-live="polite">${fieldReadinessHtml()}</div>
        <div class="actions"><button class="btn btn-primary" id="run-field-readiness" type="button">Preparar e testar aparelho</button></div>
      </section>
      <section class="card">
        <h2>Importante</h2>
        <div class="alert">Limpar dados do navegador, limpar dados do site ou remover o aplicativo pode apagar as inspeções locais. Mantenha backups periódicos.</div>
      </section>
    </div>`;
}

function bindCurrentView() {
  bindNavigation();
  document.querySelector('#page-back')?.addEventListener('click', navigateBack);
  document.querySelector('#sync-badge')?.addEventListener('click', () => {
    captureLiveUiState();
    setView('settings');
  });
  document.querySelector('#sidebar-toggle')?.addEventListener('click', toggleSidebar);
  bindHomeActions();
  bindInspectionActions();
  bindDocumentListActions();
  bindDocumentPageActions();
  bindBackupActions();
  bindPwaActions();
}

function setView(view, { resetDocsPage = false } = {}) {
  if (!view || view === state.view) {
    render();
    return;
  }
  state.previousView = state.view;
  state.view = view;
  if (resetDocsPage) state.docsPage = 1;
  render();
}

function navigateBack() {
  captureLiveUiState();
  const current = state.view;
  const fallback = current === 'doc-detail' ? 'docs' : 'home';
  const target = state.previousView && state.previousView !== current ? state.previousView : fallback;
  state.previousView = current;
  state.view = target;
  state.docsPage = 1;
  render();
}

function bindNavigation() {
  document.querySelectorAll('[data-nav]').forEach(button => {
    button.addEventListener('click', () => {
      captureLiveUiState();
      setView(button.dataset.nav, { resetDocsPage: true });
    });
  });
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem('docinspector-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');
  document.querySelector('.app-shell')?.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  render();
}

function bindHomeActions() {
  document.querySelector('#new-inspection-hero')?.addEventListener('click', newInspectionModal);
  document.querySelector('#new-verification')?.addEventListener('click', launchGlobalCameraVerification);
  document.querySelectorAll('[data-edit-inspection]').forEach(button => button.addEventListener('click', () => editInspectionModal(button.dataset.editInspection)));

  const openInspectionDocuments = inspectionId => {
    const inspection = state.inspections.find(item => item.id === inspectionId);
    if (!inspection) return showToast('Inspeção não encontrada.', 'error');
    state.docsFilters.inspectionId = inspection.id;
    state.docsFilters.system = inspection.system || '';
    state.docsFilters.text = '';
    state.docsFilters.result = '';
    state.docsFilters.status = '';
    state.docsFilters.sort = 'code';
    state.docsPage = 1;
    state.previousView = state.view;
    state.view = 'docs';
    render();
  };

  document.querySelectorAll('[data-view-inspection]').forEach(button => {
    button.addEventListener('click', () => openInspectionDocuments(button.dataset.viewInspection || ''));
  });

  document.querySelectorAll('[data-open-inspection]').forEach(card => {
    const activate = event => {
      if (event.type === 'click' && event.target.closest('button, a, input, select, textarea, label')) return;
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      if (event.type === 'keydown') event.preventDefault();
      openInspectionDocuments(card.dataset.openInspection || '');
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', activate);
  });
  document.querySelectorAll('[data-export-inspection]').forEach(button => {
    button.addEventListener('click', () => {
      const inspection = state.inspections.find(item => item.id === button.dataset.exportInspection);
      if (!inspection) return showToast('Inspeção não encontrada.', 'error');
      exportInspectionModal(inspection);
    });
  });
  document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => removeInspection(button.dataset.delete)));
}


function launchGlobalCameraVerification() {
  if (!allDocuments().length) {
    showToast('Crie uma inspeção e importe uma lista antes de iniciar uma verificação.', 'error');
    return;
  }
  captureLiveUiState();
  state.previousView = state.view;
  state.view = 'inspect';
  render();
  requestAnimationFrame(() => document.querySelector('#camera-input')?.click());
}

function editInspectionModal(id) {
  const inspection = state.inspections.find(item => item.id === id);
  if (!inspection) return showToast('Inspeção não encontrada.', 'error');

  const modal = openModal(`
    <div class="modal-head">
      <div><span class="section-kicker">LISTA DE INSPEÇÃO</span><h2>Editar informações da lista</h2></div>
      <button class="icon-button" data-close type="button" aria-label="Fechar">${icon('close')}</button>
    </div>
    <p class="subtitle">Atualize os dados de identificação da lista. Documentos, resultados, cópias e evidências serão preservados.</p>
    <div class="form-grid">
      <div class="field full">
        <label for="edit-list-name">Nome da lista</label>
        <input id="edit-list-name" maxlength="160" autocomplete="off" value="${escapeHtml(inspection.name || inspection.project)}">
      </div>
      <div class="field">
        <label for="edit-system">Sistema</label>
        <input id="edit-system" maxlength="120" autocomplete="off" value="${escapeHtml(inspection.system || '')}" required>
      </div>
      <div class="field">
        <label for="edit-responsible">Responsável</label>
        <input id="edit-responsible" maxlength="120" autocomplete="name" value="${escapeHtml(inspection.responsible || '')}" required>
      </div>
      <div class="field full">
        <label for="edit-location">Local</label>
        <input id="edit-location" maxlength="160" autocomplete="off" value="${escapeHtml(inspection.location || '')}">
      </div>
    </div>
    <div class="alert soft-alert">O nome da lista pode ser livre. O Sistema será usado nos filtros globais de documentos.</div>
    <div class="actions">
      <button class="btn" data-close type="button">Cancelar</button>
      <button class="btn btn-primary" id="save-inspection-meta" type="button">Salvar alterações</button>
    </div>`, { label: 'Editar lista de inspeção' });

  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  const nameInput = modal.querySelector('#edit-list-name');
  const systemInput = modal.querySelector('#edit-system');
  const responsibleInput = modal.querySelector('#edit-responsible');
  const locationInput = modal.querySelector('#edit-location');
  const save = modal.querySelector('#save-inspection-meta');

  save.addEventListener('click', async () => {
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    const system = systemInput.value.trim().replace(/\s+/g, ' ');
    const responsible = responsibleInput.value.trim().replace(/\s+/g, ' ');
    const location = locationInput.value.trim().replace(/\s+/g, ' ');
    if (!name) return showToast('Informe um nome para a lista.', 'error');
    if (!system) return showToast('Informe o sistema.', 'error');
    if (!responsible) return showToast('Informe o responsável.', 'error');

    try {
      setButtonBusy(save, true, 'Salvando…');
      const updatedInspection = await saveMetadataChangeResilient(inspection, { name, system, responsible, location });
      const index = state.inspections.findIndex(item => item.id === inspection.id);
      if (index >= 0) state.inspections[index] = updatedInspection;
      if (state.current?.id === inspection.id) state.current = updatedInspection;
      if (state.docsFilters.inspectionId === inspection.id) state.docsFilters.system = '';
      await refreshInspectionList({ required: false });
      modal.closeModal();
      render();
      syncNow({ announce: false }).catch(() => {});
      showToast('Lista atualizada.');
    } catch (error) {
      showToast(error.message || 'Falha ao editar a lista.', 'error');
      setButtonBusy(save, false);
    }
  });
  [nameInput, systemInput, responsibleInput, locationInput].forEach(input => {
    input.addEventListener('keydown', event => { if (event.key === 'Enter') save.click(); });
  });
  requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
}

async function openInspection(id) {
  try {
    const inspection = await getInspection(id);
    if (!inspection) throw new Error('Inspeção não encontrada.');
    state.current = inspection;
    state.selectedInspectionId = inspection.id;
    localStorage.setItem('sky17-current', inspection.id);
    state.previousView = state.view;
    state.view = 'inspect';
    render();
  } catch (error) {
    showToast(error.message || 'Falha ao abrir a inspeção.', 'error');
  }
}

async function removeInspection(id) {
  if (!window.confirm('Excluir esta inspeção? Esta ação não pode ser desfeita sem um backup.')) return;

  try {
    const inspection = state.inspections.find(item => item.id === id) || await getInspection(id);
    const evidencePaths = new Set();
    const evidenceIds = new Set();
    for (const document of inspection?.documents || []) {
      for (const copy of document.fieldCopies || []) {
        if (copy.evidencePath) evidencePaths.add(copy.evidencePath);
        if (copy.evidenceId) evidenceIds.add(copy.evidenceId);
      }
    }

    await deleteInspectionBundle(id, {
      syncEnabled: Boolean(getSyncConfig()),
      evidencePaths: [...evidencePaths],
      evidenceIds: [...evidenceIds]
    });

    syncNow({ announce: true }).catch(() => {});
    if (state.current?.id === id) {
      state.current = null;
      state.selectedDoc = null;
      localStorage.removeItem('sky17-current');
    }

    state.inspections = await listInspections();
    showToast('Inspeção e evidências locais excluídas.');
    render();
  } catch (error) {
    showToast(error.message || 'Falha ao excluir a inspeção.', 'error');
  }
}

function bindCopyQuantityControls() {
  const input = document.querySelector('#copy-quantity');
  if (!input) return;
  const normalize = () => {
    const value = Math.min(9999, Math.max(1, Number.parseInt(input.value, 10) || 1));
    input.value = String(value);
    return value;
  };
  input.addEventListener('change', normalize);
  document.querySelectorAll('[data-copy-quantity-step]').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      const next = normalize() + Number(button.dataset.copyQuantityStep || 0);
      input.value = String(Math.min(9999, Math.max(1, next)));
    });
  });
}

function goToNextDocument() {
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
}

function bindInspectionActions({ preserveFocus = false } = {}) {
  const searchInput = document.querySelector('#pw-search');
  const searchButton = document.querySelector('#find-pw');

  if (searchButton && !searchButton.dataset.bound) { searchButton.dataset.bound = '1'; searchButton.addEventListener('click', findDocument); }
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', event => { state.pwSearchQuery = event.currentTarget.value; updateSearchSuggestions(); });
    searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') findDocument(); });
  }
  const clearSearch = document.querySelector('#clear-pw-search');
  if (clearSearch && !clearSearch.dataset.bound) {
    clearSearch.dataset.bound = '1';
    clearSearch.addEventListener('click', () => {
      state.pwSearchQuery = '';
      if (searchInput) searchInput.value = '';
      updateSearchSuggestions();
      searchInput?.focus();
    });
  }
  bindSearchSuggestionActions();
  bindCopyQuantityControls();

  const nextButton = document.querySelector('#next-document');
  if (nextButton && !nextButton.dataset.bound) { nextButton.dataset.bound = '1'; nextButton.addEventListener('click', goToNextDocument); }
  const scanButton = document.querySelector('#scan-document');
  if (scanButton && !scanButton.dataset.bound) { scanButton.dataset.bound = '1'; scanButton.addEventListener('click', () => document.querySelector('#camera-input')?.click()); }
  const camera = document.querySelector('#camera-input');
  if (camera && !camera.dataset.bound) { camera.dataset.bound = '1'; camera.addEventListener('change', handleCameraCapture); }
  document.querySelectorAll('[data-copy-edit]').forEach(button => { if (!button.dataset.bound) { button.dataset.bound='1'; button.addEventListener('click', () => editCopy(button.dataset.copyEdit)); } });
  document.querySelectorAll('[data-copy-delete]').forEach(button => { if (!button.dataset.bound) { button.dataset.bound='1'; button.addEventListener('click', () => deleteCopy(button.dataset.copyDelete)); } });
  document.querySelectorAll('[data-view-copy]').forEach(button => { if (!button.dataset.bound) { button.dataset.bound='1'; button.addEventListener('click', () => viewEvidence(button.dataset.viewCopy)); } });
  const save = document.querySelector('#save-verification'); if (save && !save.dataset.bound) { save.dataset.bound='1'; save.addEventListener('click', saveVerification); }
  const notFound = document.querySelector('#mark-not-found'); if (notFound && !notFound.dataset.bound) { notFound.dataset.bound='1'; notFound.addEventListener('click', saveNotFound); }

  if (state.view === 'inspect' && !state.selectedDoc && !preserveFocus) requestAnimationFrame(() => searchInput?.focus());
}

function findDocument() {
  const input = document.querySelector('#pw-search');
  const rawQuery = input?.value ?? state.pwSearchQuery;
  state.pwSearchQuery = rawQuery;
  const code = normalizeCode(rawQuery);
  if (!code) { showToast('Digite um Código PW ou parte da descrição.', 'error'); input?.focus(); return; }

  const exact = contextsForCode(rawQuery);
  if (exact.length === 1) {
    state.pwSearchQuery = exact[0].document.code;
    selectDocumentContext(exact[0], { renderView: false });
    render();
    requestAnimationFrame(() => document.querySelector('#found-revision')?.focus());
    return;
  }

  state.selectedDoc = null;
  state.selectedInspectionId = null;
  const suggestions = documentSearchMatches(rawQuery);
  updateSearchSuggestions();
  input?.focus();
  if (exact.length > 1) showToast('Este Código PW existe em mais de uma inspeção. Selecione o projeto/sistema correto nas sugestões.', 'error');
  else if (suggestions.length) showToast('Há documentos correspondentes. Selecione uma sugestão para abrir o registro.');
  else showToast('Documento não localizado em nenhuma lista importada.', 'error');
}

function restoreDocumentSnapshot(snapshot) {
  if (!snapshot || !state.current) return;
  const index = state.current.documents.findIndex(item => item.id === snapshot.id);
  if (index >= 0) state.current.documents[index] = snapshot;
  state.selectedDoc = snapshot;
}

async function saveFieldChangeResilient(inspection, documentId) {
  try {
    await saveInspection(inspection);
    return inspection;
  } catch (error) {
    if (error?.code !== 'CONCURRENT_MODIFICATION') throw error;

    const latest = await getInspection(inspection.id);
    if (!latest) throw new Error('A inspeção foi removida em outra aba ou aparelho antes desta gravação.');

    const merged = mergeInspection(latest, inspection);
    await saveInspection(merged);

    state.current = merged;
    const index = state.inspections.findIndex(item => item.id === merged.id);
    if (index >= 0) state.inspections[index] = merged;
    if (documentId) state.selectedDoc = merged.documents.find(item => item.id === documentId) || null;
    return merged;
  }
}

async function saveMetadataChangeResilient(inspection, patch) {
  const candidate = { ...inspection, ...patch };
  try {
    await saveInspection(candidate);
    return candidate;
  } catch (error) {
    if (error?.code !== 'CONCURRENT_MODIFICATION') throw error;

    const latest = await getInspection(inspection.id);
    if (!latest) throw new Error('A inspeção foi removida em outra aba ou aparelho antes desta alteração.');
    const rebased = { ...latest, ...patch };
    await saveInspection(rebased);
    return rebased;
  }
}

async function deleteCopy(copyId) {
  if (!state.selectedDoc || !copyId) return;
  const copy = state.selectedDoc.fieldCopies?.find(item => item.id === copyId);
  if (!copy || !window.confirm(`Excluir a cópia ${copy.sequence}?`)) return;

  const snapshot = structuredClone(state.selectedDoc);
  try {
    removeFieldCopy(state.selectedDoc, copyId);
    await saveInspectionWithEvidenceDeletion(state.current, {
      syncEnabled: Boolean(getSyncConfig()),
      evidencePath: copy.evidencePath,
      evidenceId: copy.evidenceId
    });

    await refreshInspectionList({ required: false });
    syncNow({ announce: true }).catch(() => {});
    showToast('Cópia removida. A exclusão será propagada aos demais aparelhos.');
    render();
  } catch (error) {
    restoreDocumentSnapshot(snapshot);
    if (error?.code === 'CONCURRENT_MODIFICATION') {
      try {
        const latest = await getInspection(state.current.id);
        const latestDocument = latest?.documents?.find(item => item.id === snapshot.id);
        const latestCopy = latestDocument?.fieldCopies?.find(item => item.id === copyId);
        if (latest && latestDocument && latestCopy) {
          removeFieldCopy(latestDocument, copyId);
          await saveInspectionWithEvidenceDeletion(latest, {
            syncEnabled: Boolean(getSyncConfig()),
            evidencePath: latestCopy.evidencePath,
            evidenceId: latestCopy.evidenceId
          });
          state.current = latest;
          state.selectedDoc = latestDocument;
          await refreshInspectionList({ required: false });
          syncNow({ announce: true }).catch(() => {});
          showToast('Cópia removida após conciliar uma atualização concorrente.');
          render();
          return;
        }
      } catch (retryError) {
        showToast(retryError.message || 'Os dados mudaram durante a exclusão. Atualize e tente novamente.', 'error');
        return;
      }
    }
    showToast(error.message || 'Falha ao remover a cópia.', 'error');
  }
}

async function editCopy(copyId) {
  const context = selectedContext();
  const copy = context?.document?.fieldCopies?.find(item => item.id === copyId);
  if (!context || !copy) return showToast('Cópia não encontrada.', 'error');
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">HISTÓRICO</span><h2>Editar cópia ${copy.sequence}</h2></div><button class="icon-button" data-close type="button" aria-label="Fechar">${icon('close')}</button></div>
    <p class="subtitle">A edição preserva a evidência fotográfica e recalcula automaticamente o resultado consolidado do documento.</p>
    <div class="form-grid">
      <div class="field full"><label for="edit-copy-revision">Revisão encontrada</label><input id="edit-copy-revision" value="${escapeHtml(copy.foundRevision)}" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>
      <div class="field full"><label>Marcações observadas</label><div class="marking-grid">${markingOptions(copy.markings || [])}</div></div>
      <div class="field full"><label for="edit-copy-comment">Comentário</label><textarea id="edit-copy-comment" rows="3">${escapeHtml(copy.comment || '')}</textarea></div>
    </div>
    <div class="actions"><button class="btn" data-close type="button">Cancelar</button><button class="btn btn-primary" id="save-copy-edit" type="button">Salvar alterações</button></div>`, { label: `Editar cópia ${copy.sequence}` });
  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  modal.querySelector('#save-copy-edit')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const snapshot = structuredClone(context.document);
    try {
      setButtonBusy(button, true, 'Salvando…');
      const markings = [...modal.querySelectorAll('input[name="marking"]:checked')].map(input => input.value);
      updateFieldCopy(context.document, copyId, { foundRevision: modal.querySelector('#edit-copy-revision')?.value, markings, comment: modal.querySelector('#edit-copy-comment')?.value });
      state.current = context.inspection;
      state.selectedDoc = context.document;
      await saveFieldChangeResilient(context.inspection, context.document.id);
      await refreshInspectionList({ required: false });
      syncNow({ announce: true }).catch(() => {});
      modal.closeModal();
      render();
      showToast('Cópia atualizada e resultado recalculado.');
    } catch (error) {
      restoreDocumentSnapshot(snapshot);
      showToast(error.message || 'Falha ao editar a cópia.', 'error');
    } finally {
      if (button?.isConnected) setButtonBusy(button, false);
    }
  });
}

async function viewEvidence(copyId) {
  try {
    const copy = state.selectedDoc?.fieldCopies?.find(item => item.id === copyId);
    if (!copy) throw new Error('A cópia selecionada não está mais disponível.');

    let blob = null;
    let sourceLabel = 'Foto armazenada localmente neste aparelho.';

    if (copy.evidenceId) {
      const evidence = await getEvidence(copy.evidenceId).catch(() => null);
      blob = evidence?.blob || null;
    }

    if (!blob && copy.evidencePath) {
      sourceLabel = 'Foto carregada do espaço sincronizado no Supabase.';
      blob = await downloadRemoteEvidence(copy.evidencePath);
    }

    if (!blob) {
      throw new Error(copy.evidencePath
        ? 'A foto sincronizada não pôde ser carregada.'
        : 'A foto está disponível somente no aparelho onde foi capturada e ainda não foi sincronizada.');
    }

    const url = URL.createObjectURL(blob);
    const modal = openModal(`
      <div class="modal-header"><div><h2>Evidência fotográfica</h2><p class="subtitle">${escapeHtml(sourceLabel)}</p></div><button class="icon-button" id="close-evidence" type="button">${icon('close')}</button></div>
      <img class="evidence-preview full" src="${url}" alt="Evidência fotográfica do documento">
      <div class="actions"><button class="btn" id="close-evidence-bottom" type="button">Fechar</button></div>`, { label: 'Evidência fotográfica' });
    const close = () => { URL.revokeObjectURL(url); modal.closeModal(); };
    modal.querySelector('#close-evidence')?.addEventListener('click', close);
    modal.querySelector('#close-evidence-bottom')?.addEventListener('click', close);
  } catch (error) {
    showToast(error.message || 'Não foi possível abrir a foto.', 'error');
  }
}

async function handleCameraCapture(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || state.scanning) return;
  state.scanning = true;
  showToast('Analisando fotografia…');
  try {
    const prepared = await prepareEvidenceImage(file);
    const colors = detectMarkingColors(prepared.canvas);
    let ocr = { text: '', confidence: null, regions: [], analysis: null, revision: '' };
    try { ocr = await recognizeEngineeringDrawing(prepared.canvas, allDocuments()); }
    catch (error) { showToast(`${error.message} Você ainda pode confirmar os dados manualmente.`, 'error'); }
    const analysis = ocr.analysis || { document: null, detectedCode: '', confidence: 0, exact: false, candidates: [] };
    const candidate = analysis.document || null;
    const candidateContext = candidate ? allDocumentContexts().find(item => item.document === candidate || item.document.id === candidate.id) : null;
    openScanConfirmation({ file, prepared, colors, ocr, analysis, candidate, candidateContext, revision: ocr.revision || '' });
  } catch (error) { showToast(error.message || 'Não foi possível analisar a fotografia.', 'error'); }
  finally { state.scanning = false; }
}

function openScanConfirmation(scan) {
  const previewUrl = URL.createObjectURL(scan.prepared.blob);
  const code = scan.analysis?.detectedCode || '';
  const nextCopy = (scan.candidate?.fieldCopies?.length || 0) + 1;
  const codeStatus = scan.analysis?.exact
    ? 'Correspondência exata com a lista importada.'
    : scan.analysis?.ambiguous
      ? 'Código ambíguo: mais de um documento da lista possui a mesma sequência alfanumérica.'
      : (code ? 'Documento não localizado na lista importada. Confira o código diretamente na fotografia.' : 'O OCR não encontrou um Código PW confiável. Informe-o manualmente.');
  const modal = openModal(`
    <div class="modal-header">
      <div><span class="section-kicker">ANÁLISE DA FOTO</span><h2>Confirmar informações</h2><p class="subtitle">Revise os dados antes de contabilizar a cópia.</p></div>
      <button class="icon-button" id="scan-close" type="button" aria-label="Fechar">${icon('close')}</button>
    </div>
    <div class="scan-confirm-grid">
      <div class="scan-preview-wrap"><img class="evidence-preview" src="${previewUrl}" alt="Fotografia capturada para análise"></div>
      <div class="scan-confirm-fields">
        <div class="field"><label for="scan-code">Código PW identificado</label><input id="scan-code" value="${escapeHtml(code)}" autocapitalize="characters" autocomplete="off" spellcheck="false"><small id="scan-code-status" class="field-help${scan.analysis?.exact ? '' : ' field-error'}">${escapeHtml(codeStatus)}</small><small class="field-help">O DocInspector não substitui caracteres do PW para aproximá-lo de outro documento da lista.</small></div>
        <div class="field"><label for="scan-revision">Revisão identificada</label><input id="scan-revision" value="${escapeHtml(scan.revision)}" autocapitalize="characters" autocomplete="off" spellcheck="false"><small class="field-help">${scan.revision ? 'Sugestão do OCR — confirme visualmente na fotografia.' : 'O OCR não encontrou uma revisão confiável. Informe-a manualmente.'}</small></div>
        <div class="field full"><label>Marcações sugeridas pela imagem</label><div class="marking-grid">${markingOptions(scan.colors.markings)}</div><small class="field-help">A detecção de cores é uma sugestão. Confirme visualmente antes de salvar.</small></div>
        <div class="field full"><label for="scan-comment">Comentário (opcional)</label><textarea id="scan-comment" rows="3" placeholder="Observações desta cópia…"></textarea></div>
        <div class="scan-copy-notice" id="scan-copy-notice">${scan.analysis?.exact ? `Se confirmado, este registro será a <strong>Cópia ${nextCopy}</strong> de ${escapeHtml(scan.candidate.code)}.` : 'Confirme/corrija o Código PW para localizar o documento antes de contabilizar a cópia.'}</div>
      </div>
    </div>
    <div class="modal-message" id="scan-message" hidden></div>
    <div class="actions modal-actions"><button class="btn" id="scan-cancel" type="button">Cancelar</button><button class="btn btn-primary" id="scan-confirm" type="button">Confirmar cópia</button></div>
  `, { label: 'Confirmar análise da fotografia' });

  const cleanup = () => { URL.revokeObjectURL(previewUrl); modal.closeModal(); };
  modal.querySelector('#scan-close')?.addEventListener('click', cleanup);
  modal.querySelector('#scan-cancel')?.addEventListener('click', cleanup);

  const codeInput = modal.querySelector('#scan-code');
  const status = modal.querySelector('#scan-code-status');
  const notice = modal.querySelector('#scan-copy-notice');
  const revisionInput = modal.querySelector('#scan-revision');
  const confirmButton = modal.querySelector('#scan-confirm');
  const resolveDocument = () => {
    const matches = equivalentContextsForCode(codeInput.value);
    const foundContext = matches.length === 1 ? matches[0] : null;
    const found = foundContext?.document || null;
    const ambiguous = matches.length > 1;
    status.textContent = found
      ? `Documento localizado em ${foundContext.inspection.system} · ${foundContext.inspection.project}.`
      : ambiguous
        ? 'Código ambíguo: mais de um documento da lista corresponde a esta sequência. Corrija a lista antes de registrar.'
        : 'Documento não localizado na lista importada.';
    status.classList.toggle('field-error', !found);
    status.setAttribute('role', 'status');
    codeInput.setAttribute('aria-invalid', found ? 'false' : 'true');
    notice.innerHTML = found
      ? `Se confirmado, este registro será a <strong>Cópia ${(found.fieldCopies?.length || 0) + 1}</strong> de ${escapeHtml(found.code)}.`
      : ambiguous
        ? 'Não é seguro contabilizar esta cópia enquanto a identificação estiver ambígua.'
        : 'Informe um Código PW válido para contabilizar esta cópia.';
    if (confirmButton) confirmButton.disabled = !(found && normalizeCode(revisionInput?.value));
    return foundContext;
  };
  codeInput.addEventListener('input', resolveDocument);
  revisionInput?.addEventListener('input', resolveDocument);
  resolveDocument();

  confirmButton?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const message = modal.querySelector('#scan-message');
    try {
      setButtonBusy(button, true, 'Salvando…');
      const foundContext = resolveDocument();
      const found = foundContext?.document;
      if (!found || !foundContext) throw new Error('O Código PW informado não possui uma correspondência única nas listas de inspeção.');
      state.current = foundContext.inspection;
      state.selectedInspectionId = foundContext.inspection.id;
      const revision = normalizeCode(modal.querySelector('#scan-revision')?.value);
      if (!revision) throw new Error('Informe ou confirme a revisão encontrada antes de salvar.');
      const markings = [...modal.querySelectorAll('input[name="marking"]:checked')].map(input => input.value);
      const evidenceId = createId();
      let evidenceSaved = false;
      let copyAdded = false;
      try {
        await saveEvidence({ id: evidenceId, blob: scan.prepared.blob, name: scan.file.name });
        evidenceSaved = true;
        addFieldCopy(found, {
          foundRevision: revision,
          markings,
          comment: modal.querySelector('#scan-comment')?.value,
          source: 'camera',
          evidenceId,
          photoName: scan.file.name,
          recognition: {
          detectedCode: scan.analysis?.detectedCode || '',
          detectedRevision: scan.revision,
          codeCandidates: scan.analysis?.candidates || [],
          exactCodeMatch: Boolean(scan.analysis?.exact),
          text: scan.ocr.text,
          confidence: scan.ocr.confidence,
          regions: Array.isArray(scan.ocr.regions) ? scan.ocr.regions.map(region => ({ region: region.region, confidence: region.confidence })) : [],
          colorConfidence: scan.colors.confidence
          }
        });
        copyAdded = true;
        await saveFieldChangeResilient(state.current, found.id);
      } catch (error) {
        if (copyAdded) removeFieldCopy(found, (found.fieldCopies || []).find(copy => copy.evidenceId === evidenceId)?.id, { tombstone: false });
        if (evidenceSaved) await deleteEvidence(evidenceId).catch(() => {});
        throw error;
      }
      await refreshInspectionList({ required: false });
      syncNow({ announce: true }).catch(() => {});
      state.selectedDoc = found;
      state.selectedInspectionId = foundContext.inspection.id;
      showToast(`Cópia ${found.copyCount} confirmada para ${found.code} · ${foundContext.inspection.system}.`);
      cleanup();
      render();
    } catch (error) {
      message.hidden = false;
      message.className = 'modal-message error';
      message.textContent = error.message || 'Não foi possível confirmar a cópia.';
    } finally {
      if (button.isConnected) setButtonBusy(button, false);
    }
  });
}

async function saveVerification(event) {
  const button = event?.currentTarget;
  const snapshot = state.selectedDoc ? structuredClone(state.selectedDoc) : null;
  try {
    setButtonBusy(button, true, 'Salvando…');
    const context = selectedContext();
    if (!context) throw new Error('O documento selecionado não está mais disponível.');
    state.current = context.inspection;
    state.selectedInspectionId = context.inspection.id;
    state.selectedDoc = context.document;
    const markings = [...document.querySelectorAll('input[name="marking"]:checked')].map(input => input.value);
    const revision = document.querySelector('#found-revision')?.value;
    const comment = document.querySelector('#comment')?.value;
    const quantity = Math.min(9999, Math.max(1, Number.parseInt(document.querySelector('#copy-quantity')?.value, 10) || 1));
    for (let index = 0; index < quantity; index += 1) {
      addFieldCopy(state.selectedDoc, { foundRevision: revision, markings, comment, source: 'manual' });
    }

    await saveFieldChangeResilient(state.current, state.selectedDoc.id);
    await refreshInspectionList({ required: false });
    syncNow({ announce: true }).catch(() => {});
    showToast(`${quantity} ${quantity === 1 ? 'cópia registrada' : 'cópias registradas'}: ${state.selectedDoc.result}.`);
    returnToSearch();
  } catch (error) {
    if (snapshot) restoreDocumentSnapshot(snapshot);
    showToast(error.message || 'Falha ao salvar a verificação.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function saveNotFound(event) {
  const button = event?.currentTarget;
  const snapshot = state.selectedDoc ? structuredClone(state.selectedDoc) : null;
  try {
    setButtonBusy(button, true, 'Salvando…');
    const context = selectedContext();
    if (!context) throw new Error('O documento selecionado não está mais disponível.');
    state.current = context.inspection;
    state.selectedInspectionId = context.inspection.id;
    state.selectedDoc = context.document;
    markNotFound(state.selectedDoc, document.querySelector('#comment')?.value);
    await saveFieldChangeResilient(state.current, state.selectedDoc.id);
    await refreshInspectionList({ required: false });
    syncNow({ announce: true }).catch(() => {});
    showToast('Documento marcado como não encontrado.');
    returnToSearch();
  } catch (error) {
    if (snapshot) restoreDocumentSnapshot(snapshot);
    showToast(error.message || 'Falha ao salvar o registro.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

function returnToSearch() {
  state.selectedDoc = null;
  state.selectedInspectionId = null;
  state.pwSearchQuery = '';
  render();
}

async function refreshInspectionList({ required = true } = {}) {
  try {
    state.inspections = await listInspections();
    return true;
  } catch (error) {
    if (required) throw error;
    return false;
  }
}

function exportCurrentInspection() {
  if (state.current) exportInspectionModal(state.current);
}

function exportInspectionModal(inspection) {
  if (!inspection?.documents?.length) return showToast('Não há documentos para exportar.', 'error');
  const data = metrics(inspection.documents || []);
  const modal = openModal(`
    <div class="modal-head"><div><span class="section-kicker">EXPORTAÇÃO</span><h2>Exportar relatório</h2></div><button class="icon-button" data-close type="button" aria-label="Fechar">${icon('close')}</button></div>
    <div class="export-report-preview"><div><span class="section-kicker">SISTEMA</span><strong>${escapeHtml(inspection.system || 'Sem sistema')}</strong><small>${escapeHtml(inspection.name || inspection.project)}</small></div><div class="export-preview-stats"><span>${data.conforming} conformes</span><span>${data.nonconforming} não conformes</span><span>${data.notFound} não encontrados</span><span>${data.pending} pendentes</span></div></div>
    <section class="export-result-panel"><div class="export-result-heading"><div><span class="section-kicker">SELEÇÃO DO RELATÓRIO</span><h3>Quais resultados deseja exportar?</h3><p>Selecione uma ou mais categorias. Nenhuma opção é marcada automaticamente.</p></div></div>
      <div class="export-result-options" role="group" aria-label="Resultados que serão exportados">
        <label class="export-result-option conforming"><input type="checkbox" id="exp-conforming"><span class="export-check-indicator" aria-hidden="true"></span><span class="export-option-copy"><strong>Conformes</strong><small>${data.conforming} documentos</small></span></label>
        <label class="export-result-option nonconforming"><input type="checkbox" id="exp-nonconforming"><span class="export-check-indicator" aria-hidden="true"></span><span class="export-option-copy"><strong>Não conformes</strong><small>${data.nonconforming} documentos</small></span></label>
        <label class="export-result-option notfound"><input type="checkbox" id="exp-notfound"><span class="export-check-indicator" aria-hidden="true"></span><span class="export-option-copy"><strong>Não encontrados</strong><small>${data.notFound} documentos</small></span></label>
        <label class="export-result-option pending"><input type="checkbox" id="exp-pending"><span class="export-check-indicator" aria-hidden="true"></span><span class="export-option-copy"><strong>Pendentes</strong><small>${data.pending} documentos</small></span></label>
      </div><p class="export-selection-note">PDF, XLSX e Word usam exatamente o mesmo conjunto selecionado, evitando divergência e repetição entre formatos.</p></section>
    <div class="alert soft-alert export-format-note">PDF preserva o layout final, XLSX mantém análise tabular e Word (.doc) gera uma versão editável.</div>
    <div class="actions export-actions"><button class="btn" data-close type="button">Cancelar</button><button class="btn" id="generate-word" type="button">Gerar Word</button><button class="btn" id="generate-pdf" type="button">Gerar PDF</button><button class="btn btn-primary" id="generate-xlsx" type="button">Gerar XLSX</button></div>`, { label: 'Exportar relatório da inspeção' });

  modal.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => modal.closeModal()));
  const selectedData = () => { const options = exportOptionsFromModal(modal); return { options, data: buildInspectionExportData(inspection, options) }; };
  modal.querySelector('#generate-xlsx').addEventListener('click', async event => {
    const button = event.currentTarget;
    try { setButtonBusy(button, true, 'Gerando XLSX…'); const { options } = selectedData(); await exportInspection(inspection, options); showToast('Arquivo XLSX gerado.'); modal.closeModal(); }
    catch (error) { showToast(error.message || 'Falha ao gerar XLSX.', 'error'); }
    finally { if (button?.isConnected) setButtonBusy(button, false); }
  });
  modal.querySelector('#generate-pdf').addEventListener('click', event => {
    const button = event.currentTarget;
    try { setButtonBusy(button, true, 'Gerando PDF…'); const { data: exportData } = selectedData(); exportInspectionPdf(inspection, exportData); showToast('Arquivo PDF gerado.'); modal.closeModal(); }
    catch (error) { showToast(error.message || 'Falha ao gerar PDF.', 'error'); }
    finally { if (button?.isConnected) setButtonBusy(button, false); }
  });
  modal.querySelector('#generate-word').addEventListener('click', event => {
    const button = event.currentTarget;
    try { setButtonBusy(button, true, 'Gerando Word…'); const { data: exportData } = selectedData(); exportInspectionWord(inspection, exportData); showToast('Arquivo Word editável gerado.'); modal.closeModal(); }
    catch (error) { showToast(error.message || 'Falha ao gerar Word.', 'error'); }
    finally { if (button?.isConnected) setButtonBusy(button, false); }
  });
}

function exportOptionsFromModal(modal) {
  const option = id => Boolean(modal.querySelector(`#${id}`)?.checked);
  const options = {
    includeConforming: option('exp-conforming'),
    includeNonconforming: option('exp-nonconforming'),
    includeNotFound: option('exp-notfound'),
    includePending: option('exp-pending'),
    includeSummary: true,
    includeDocuments: true,
    includeCopies: true,
    includeComments: true,
    includeMarkings: true,
    includeEvidence: true
  };

  if (!options.includeConforming && !options.includeNonconforming && !options.includeNotFound && !options.includePending) {
    throw new Error('Selecione pelo menos um resultado para exportar.');
  }
  return options;
}

function bindDocumentListActions() {
  if (state.view !== 'docs') return;

  document.querySelector('#export-selected-inspection')?.addEventListener('click', () => {
    const inspection = state.inspections.find(item => item.id === state.docsFilters.inspectionId);
    if (!inspection) return showToast('Selecione uma lista de inspeção para exportar.', 'error');
    exportInspectionModal(inspection);
  });

  document.querySelector('#clear-doc-filters')?.addEventListener('click', () => {
    state.docsFilters = { text: '', system: '', inspectionId: '', result: '', status: '', sort: 'code' };
    state.docsPage = 1;
    render();
  });

  const bindings = [
    ['#filter-text', 'input', 'text'], ['#filter-inspection', 'change', 'inspectionId'], ['#filter-system', 'change', 'system'], ['#filter-result', 'change', 'result'],
    ['#filter-status', 'change', 'status'], ['#sort-docs', 'change', 'sort']
  ];
  bindings.forEach(([selector, eventName, key]) => {
    const element = document.querySelector(selector);
    element?.addEventListener(eventName, () => { state.docsFilters[key] = element.value; if (key === 'inspectionId' && element.value) state.docsFilters.system = ''; if (key === 'system' && element.value) state.docsFilters.inspectionId = ''; state.docsPage = 1; refreshRows(); });
  });
  const docsBody = document.querySelector('#docs-body');
  docsBody?.addEventListener('click', event => {
    const button = event.target.closest('[data-doc-details]');
    if (button) { openDocumentDetails(button.dataset.inspectionDetails, button.dataset.docDetails); return; }
    const row = event.target.closest('tr[data-doc-row]');
    if (row) openDocumentDetails(row.dataset.inspectionRow, row.dataset.docRow);
  });
  docsBody?.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || event.target.closest('button')) return;
    const row = event.target.closest('tr[data-doc-row]');
    if (!row) return;
    event.preventDefault();
    openDocumentDetails(row.dataset.inspectionRow, row.dataset.docRow);
  });
  document.querySelector('#docs-pagination')?.addEventListener('click', event => {
    if (event.target.closest('#docs-prev')) state.docsPage -= 1;
    if (event.target.closest('#docs-next')) state.docsPage += 1;
    refreshRows();
  });
}

function getFilteredDocuments({ fromState = false } = {}) {
  if (!fromState) captureLiveUiState();
  const text = normalizeSearchText(state.docsFilters.text);
  const system = state.docsFilters.system;
  const inspectionId = state.docsFilters.inspectionId;
  const result = state.docsFilters.result;
  const status = state.docsFilters.status;
  const sortBy = state.docsFilters.sort || 'code';

  return allDocumentContexts()
    .filter(({ inspection, document }) => {
      const matchesText = !text || normalizeSearchText(document.code).includes(text) || normalizeSearchText(document.description).includes(text);
      const matchesInspection = !inspectionId || inspection.id === inspectionId;
      const matchesSystem = !system || inspection.system === system;
      const matchesResult = !result || document.result === result;
      const matchesStatus = !status || document.status === status;
      return matchesInspection && matchesText && matchesSystem && matchesResult && matchesStatus;
    })
    .sort((a, b) => {
      const av = sortBy === 'system' ? a.inspection.system : a.document[sortBy];
      const bv = sortBy === 'system' ? b.inspection.system : b.document[sortBy];
      return String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR', { numeric: true });
    });
}

function refreshRows() {
  if (state.view !== 'docs') return;
  const contexts = getFilteredDocuments();
  const pages = Math.max(1, Math.ceil(contexts.length / DOCS_PAGE_SIZE));
  state.docsPage = Math.min(Math.max(1, state.docsPage), pages);
  const start = (state.docsPage - 1) * DOCS_PAGE_SIZE;
  const visible = contexts.slice(start, start + DOCS_PAGE_SIZE);
  const body = document.querySelector('#docs-body');
  const pagination = document.querySelector('#docs-pagination');
  if (body) body.innerHTML = rowsHtml(visible);
  if (pagination) pagination.innerHTML = paginationHtml(contexts.length, state.docsPage);
  refreshDocumentsDashboard();
}

function openDocumentFromList(documentId, inspectionId) {
  openDocumentDetails(inspectionId, documentId);
}

function openDocumentDetails(inspectionId, documentId) {
  const context = documentContext(inspectionId, documentId);
  if (!context) return showToast('Documento não encontrado.', 'error');
  selectDocumentContext(context, { renderView: false });
  state.previousView = state.view;
  state.view = 'doc-detail';
  render();
}

function bindDocumentPageActions() {
  if (state.view !== 'doc-detail') return;
  document.querySelector('#verify-this-document')?.addEventListener('click', () => {
    const context = selectedContext();
    if (!context) return;
    state.pwSearchQuery = context.document.code;
    state.previousView = state.view;
    state.view = 'inspect';
    render();
    requestAnimationFrame(() => document.querySelector('#found-revision')?.focus());
  });
  document.querySelectorAll('[data-copy-edit]').forEach(button => button.addEventListener('click', () => editCopy(button.dataset.copyEdit)));
  document.querySelectorAll('[data-copy-delete]').forEach(button => button.addEventListener('click', () => deleteCopy(button.dataset.copyDelete)));
  document.querySelectorAll('[data-view-copy]').forEach(button => button.addEventListener('click', () => viewEvidence(button.dataset.viewCopy)));
}

function refreshDocumentFilterOptions() {
  if (state.view !== 'docs') return;
  const listSelect = document.querySelector('#filter-inspection');
  if (listSelect) {
    const currentList = state.docsFilters.inspectionId;
    listSelect.innerHTML = `<option value="">Todas as listas</option>${state.inspections.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.system || 'Sem sistema')} · ${escapeHtml(item.name || item.project)}</option>`).join('')}`;
    listSelect.value = state.inspections.some(item => item.id === currentList) ? currentList : '';
    if (!state.inspections.some(item => item.id === currentList)) state.docsFilters.inspectionId = '';
  }
  const select = document.querySelector('#filter-system');
  if (!select) return;
  const systems = [...new Set(state.inspections.map(item => item.system).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const current = state.docsFilters.system;
  select.innerHTML = `<option value="">Todos os sistemas</option>${systems.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  select.value = systems.includes(current) ? current : '';
  if (!systems.includes(current)) state.docsFilters.system = '';
}

function bindBackupActions() {
  document.querySelector('#run-field-readiness')?.addEventListener('click', runFieldReadinessCheck);
  document.querySelector('#configure-sync')?.addEventListener('click', syncSetupModal);
  document.querySelector('#test-current-sync')?.addEventListener('click', testCurrentSyncConnection);
  document.querySelector('#sync-now')?.addEventListener('click', manualSync);
  document.querySelector('#copy-sync-code')?.addEventListener('click', copySyncCode);
  document.querySelector('#disconnect-sync')?.addEventListener('click', disconnectCurrentDevice);
  document.querySelector('#backup')?.addEventListener('click', createBackup);
  document.querySelector('#restore')?.addEventListener('click', () => {
    document.querySelector('#restore-file')?.click();
  });
  document.querySelector('#restore-file')?.addEventListener('change', restoreBackup);
}


function syncSetupModal() {
  const modal = openModal(`
    <div class="modal-header">
      <div>
        <h2>Sincronização Supabase</h2>
        <p class="subtitle">Crie um espaço ou conecte este aparelho a um espaço já existente.</p>
      </div>
      <button class="icon-button modal-close" data-close type="button" aria-label="Fechar">${icon('close')}</button>
    </div>
    <div id="sync-inline-status" class="inline-status" role="status" aria-live="polite" hidden></div>
    <div class="sync-setup-tabs">
      <section class="sync-setup-section">
        <h3>Criar novo espaço</h3>
        <div class="form-grid sync-form-grid">
          <div class="field full">
            <label for="sync-url">Project URL</label>
            <input id="sync-url" type="text" inputmode="url" placeholder="https://seu-projeto.supabase.co" autocomplete="off" autocapitalize="none" spellcheck="false">
            <small class="field-help">Aceita também a URL da Data API ou apenas o Project ID.</small>
          </div>
          <div class="field full">
            <label for="sync-key">Publishable Key</label>
            <input id="sync-key" type="password" placeholder="sb_publishable_..." autocomplete="off" autocapitalize="none" spellcheck="false">
            <small class="field-help">Use somente a Publishable Key. Nunca use Secret Key ou service_role no navegador.</small>
          </div>
          <div class="field full"><label for="sync-name">Nome do espaço</label><input id="sync-name" value="DocInspector" maxlength="80" autocomplete="off"></div>
        </div>
        <div class="actions sync-setup-actions">
          <button class="btn" id="test-sync-connection" type="button">Testar conexão</button>
          <button class="btn btn-primary" id="create-sync-space" type="button">Criar espaço e sincronizar</button>
        </div>
      </section>
      <div class="sync-divider"><span>ou</span></div>
      <section class="sync-setup-section sync-join-section">
        <h3>Conectar outro aparelho</h3>
        <div class="field">
          <label for="sync-code">Código de conexão</label>
          <div class="sync-code-row">
            <input id="sync-code" class="sync-code-input" type="text" inputmode="text" placeholder="Cole o código copiado no outro aparelho" autocomplete="off" autocapitalize="none" spellcheck="false">
            <button class="btn btn-compact" id="paste-sync-code" type="button">Colar</button>
          </div>
          <small class="field-help">O código funciona como uma credencial. Compartilhe-o apenas entre aparelhos autorizados.</small>
        </div>
        <button class="btn" id="join-sync-space" type="button">Conectar a este espaço</button>
      </section>
    </div>`, { label: 'Configurar sincronização' });

  const status = modal.querySelector('#sync-inline-status');
  const setStatus = (message = '', type = '') => {
    status.hidden = !message;
    status.className = `inline-status ${type}`.trim();
    status.textContent = message;
  };

  modal.querySelector('[data-close]').addEventListener('click', () => modal.closeModal());
  modal.querySelector('#paste-sync-code').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error('A área de transferência está vazia.');
      modal.querySelector('#sync-code').value = text.trim();
      setStatus('Código colado. Você já pode conectar este aparelho.', 'success');
    } catch {
      setStatus('Não foi possível ler a área de transferência. Cole o código manualmente.', 'error');
      modal.querySelector('#sync-code').focus();
    }
  });
  modal.querySelector('#test-sync-connection').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setStatus();
      setButtonBusy(button, true, 'Testando…');
      const result = await testSupabaseConnection({
        url: modal.querySelector('#sync-url').value,
        publishableKey: modal.querySelector('#sync-key').value
      });
      modal.querySelector('#sync-url').value = result.url;
      setStatus('Conexão validada. O banco está preparado para esta versão.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      if (modal.isConnected) setButtonBusy(button, false);
    }
  });
  modal.querySelector('#create-sync-space').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setStatus();
      setButtonBusy(button, true, 'Conectando…');
      await createSyncWorkspace({
        url: modal.querySelector('#sync-url').value,
        publishableKey: modal.querySelector('#sync-key').value,
        name: modal.querySelector('#sync-name').value
      });
      modal.closeModal();
      showToast('Espaço de sincronização criado.');
      render();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      if (modal.isConnected) setButtonBusy(button, false);
    }
  });
  modal.querySelector('#join-sync-space').addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      setStatus();
      setButtonBusy(button, true, 'Conectando…');
      await connectWithCode(modal.querySelector('#sync-code').value);
      modal.closeModal();
      state.inspections = await listInspections();
      showToast('Aparelho conectado ao espaço de sincronização.');
      render();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      if (modal.isConnected) setButtonBusy(button, false);
    }
  });
}

async function testCurrentSyncConnection(event) {
  const button = event.currentTarget;
  const config = getSyncConfig();
  if (!config) return showToast('Sincronização não configurada.', 'error');
  try {
    setButtonBusy(button, true, 'Testando…');
    await testConfiguredSyncConnection();
    showToast('Conexão validada: banco, espaço e leitura/gravação/exclusão de evidências no Storage estão funcionando.');
  } catch (error) {
    showToast(error.message || 'Falha ao testar a conexão.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function manualSync(event) {
  const button = event.currentTarget;
  try {
    setButtonBusy(button, true, 'Sincronizando…');
    await syncNow({ announce: true });
    state.inspections = await listInspections();
    if (state.current?.id) state.current = await getInspection(state.current.id) || state.current;
    showToast('Sincronização concluída.');
    render();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function copySyncCode() {
  try {
    await navigator.clipboard.writeText(getConnectionCode());
    showToast('Código de conexão copiado. Use-o apenas nos seus aparelhos.');
  } catch {
    const code = getConnectionCode();
    const modal = openModal(`
      <h2>Código de conexão</h2>
      <p class="subtitle">Copie este código manualmente e use-o apenas nos aparelhos autorizados.</p>
      <div class="field"><input id="manual-sync-code" class="sync-code-input" type="text" readonly value="${escapeHtml(code)}"></div>
      <div class="actions"><button class="btn btn-primary" data-close type="button">Fechar</button></div>`, { label: 'Código de conexão' });
    modal.querySelector('[data-close]').addEventListener('click', () => modal.closeModal());
    requestAnimationFrame(() => modal.querySelector('#manual-sync-code')?.select());
  }
}

async function disconnectCurrentDevice() {
  if (!window.confirm('Desconectar este aparelho da sincronização? Os dados já salvos neste dispositivo permanecerão disponíveis.')) return;
  await disconnectSync();
  showToast('Este aparelho voltou ao modo somente local.');
  render();
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return 'indisponível';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function evidenceSyncStats(inspections = state.inspections) {
  const copies = inspections.flatMap(inspection =>
    (inspection.documents || []).flatMap(document => document.fieldCopies || [])
  );
  const withEvidence = copies.filter(copy => copy.evidenceId || copy.evidencePath);
  const localEvidence = new Map((await listEvidence().catch(() => [])).map(item => [item.id, item]));
  const pending = withEvidence.filter(copy => copy.evidenceId && !copy.evidencePath);

  const unavailable = copies.filter(copy => copy.evidenceUnavailableAt && !copy.evidencePath);
  return {
    total: withEvidence.length + unavailable.length,
    pending: pending.length,
    remote: withEvidence.filter(copy => copy.evidencePath).length,
    unavailable: unavailable.length,
    missingLocalBlob: pending.filter(copy => !localEvidence.get(copy.evidenceId)?.blob).length,
    failedUpload: pending.filter(copy => Boolean(localEvidence.get(copy.evidenceId)?.lastSyncError)).length,
    attempts: pending.reduce((sum, copy) => sum + (Number(localEvidence.get(copy.evidenceId)?.syncAttempts) || 0), 0),
    errors: pending
      .map(copy => localEvidence.get(copy.evidenceId)?.lastSyncError)
      .filter(Boolean)
      .slice(0, 3)
  };
}

async function runFieldReadinessCheck(event) {
  const button = event?.currentTarget;
  const checks = [];
  const add = (label, ok, detail, warning = false) => {
    checks.push({ label, ok, detail, warning });
    state.fieldReadiness = { status: 'running', checks: [...checks], message: 'Executando verificações…' };
    paintFieldReadiness();
  };
  const progress = message => {
    state.fieldReadiness = { status: 'running', checks: [...checks], message };
    paintFieldReadiness();
  };

  try {
    setButtonBusy(button, true, 'Preparando…');
    progress('Iniciando diagnóstico…');

    const local = await listInspections();
    add('Banco local', true, `${local.length} inspeção(ões) acessível(is)`);

    let storage = await getStorageReadiness();
    if (storage.persisted === false && navigator.storage?.persist) {
      progress('Solicitando persistência do armazenamento…');
      await navigator.storage.persist().catch(() => false);
      storage = await getStorageReadiness();
    }
    add(
      'Persistência do armazenamento',
      storage.persisted !== false,
      storage.persisted === true ? 'armazenamento persistente concedido' : 'o navegador não confirmou persistência',
      storage.persisted !== true
    );
    if (storage.available != null) {
      add('Espaço disponível', storage.available >= 50 * 1024 * 1024, `${formatBytes(storage.available)} disponíveis`, storage.available < 100 * 1024 * 1024);
    }

    if (navigator.onLine) {
      progress('Preparando bibliotecas offline…');
      const cached = await prepareOfflineDependencies();
      add('Bibliotecas offline', true, `${cached.cached} bibliotecas essenciais armazenadas`);
      progress('Inicializando motor OCR…');
      await prepareOcrRuntime(info => {
        if (info?.status) progress(`Preparando OCR: ${info.status}`);
      });
      add('Motor OCR', true, 'núcleo e idioma inicializados neste aparelho');
    } else {
      const depsLoaded = Boolean(globalThis.XLSX && globalThis.ExcelJS && globalThis.jspdf?.jsPDF && globalThis.Tesseract?.createWorker);
      add('Bibliotecas em modo offline', depsLoaded, depsLoaded ? 'bibliotecas principais já carregadas' : 'reconecte-se antes do primeiro uso em campo', !depsLoaded);
      add('Motor OCR', Boolean(globalThis.Tesseract?.createWorker), 'a preparação completa deve ser feita online antes do campo', true);
    }

    if ('serviceWorker' in navigator) {
      progress('Validando PWA / Service Worker…');
      const registration = await navigator.serviceWorker.ready;
      add('PWA / Service Worker', Boolean(registration.active), registration.active ? 'ativo e pronto para modo offline' : 'não ativo');
    } else {
      add('PWA / Service Worker', false, 'não suportado neste navegador');
    }

    if (getSyncConfig()) {
      if (navigator.onLine) {
        try {
          progress('Testando banco e Storage do Supabase…');
          const connection = await testConfiguredSyncConnection();
          add(
            'Supabase',
            Boolean(connection.workspaceVerified && connection.storageWriteVerified && connection.storageDeleteVerified),
            'banco, workspace e leitura/gravação/exclusão do Storage validados'
          );
          progress('Aguardando sincronização das inspeções e evidências…');
          await syncNow({ announce: false });
          await refreshInspectionList({ required: false });
        } catch (error) {
          add('Supabase / sincronização', false, error.message || 'A validação remota falhou.');
        }
      } else {
        add('Supabase', true, 'configurado; validação remota adiada porque o aparelho está offline', true);
      }
    } else {
      add('Supabase', true, 'modo somente local — mantenha backups frequentes', true);
    }

    progress('Conferindo evidências fotográficas…');
    const evidence = await evidenceSyncStats(await listInspections());
    if (evidence.missingLocalBlob > 0) {
      add(
        'Evidências fotográficas',
        false,
        `${evidence.missingLocalBlob} referência(s) de foto não possuem mais o arquivo local e também não estão na nuvem`
      );
    } else if (evidence.failedUpload > 0) {
      add(
        'Evidências fotográficas',
        false,
        `${evidence.failedUpload} foto(s) não puderam ser enviadas. ${evidence.errors[0] || 'Verifique a conexão e o Storage.'}`
      );
    } else if (evidence.unavailable > 0) {
      add(
        'Evidências fotográficas',
        true,
        `${evidence.remote} foto(s) na nuvem; ${evidence.unavailable} registro(s) histórico(s) sem o arquivo fotográfico original`,
        true
      );
    } else {
      add(
        'Evidências fotográficas',
        evidence.pending === 0,
        evidence.pending
          ? `${evidence.pending} foto(s) preservada(s) localmente e aguardando a próxima sincronização`
          : `${evidence.remote} foto(s) armazenada(s) na nuvem ou nenhuma evidência pendente`,
        evidence.pending > 0
      );
    }

    const failures = checks.filter(item => !item.ok && !item.warning);
    const warnings = checks.filter(item => item.warning);
    const status = failures.length ? 'error' : warnings.length ? 'warning' : 'success';
    state.fieldReadiness = { status, checks: [...checks], message: '' };
    paintFieldReadiness();
    if (!failures.length) localStorage.setItem('docinspector-field-ready-at', new Date().toISOString());
  } catch (error) {
    state.fieldReadiness = {
      status: 'error',
      checks: [...checks],
      message: error.message || 'O diagnóstico não pôde ser concluído.'
    };
    paintFieldReadiness();
    showToast(error.message || 'Falha no diagnóstico para campo.', 'error');
  } finally {
    const currentButton = document.querySelector('#run-field-readiness');
    if (currentButton) setButtonBusy(currentButton, false);
    else if (button?.isConnected) setButtonBusy(button, false);
  }
}

async function sha256Hex(text) {
  if (!crypto?.subtle) throw new Error('Este navegador não oferece suporte ao verificador de integridade do backup.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createBackup(event) {
  const button = event?.currentTarget;
  try {
    setButtonBusy(button, true, 'Gerando…');
    await refreshInspectionList();

    if (getSyncConfig() && navigator.onLine) {
      await syncNow({ announce: false }).catch(() => false);
      await refreshInspectionList({ required: false });
    }

    const evidence = await evidenceSyncStats(state.inspections);
    if (evidence.pending > 0) {
      const proceed = window.confirm(`${evidence.pending} fotografia(s) ainda aguardam sincronização com a nuvem e não entram no backup JSON. Recomenda-se sincronizar as evidências antes do backup. Deseja gerar o backup mesmo assim?`);
      if (!proceed) return;
    }

    const inspectionsSnapshot = structuredClone(state.inspections);
    const digest = await sha256Hex(JSON.stringify(inspectionsSnapshot));
    const payload = {
      app: 'DocInspector',
      version: 4,
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      integrity: { algorithm: 'SHA-256', inspections: digest },
      evidenceManifest: {
        totalReferences: evidence.total,
        synchronized: evidence.remote,
        localOnlyNotIncluded: evidence.pending
      },
      inspections: inspectionsSnapshot
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `DocInspector-backup-${timestamp}.json`;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(evidence.pending ? 'Backup gerado com aviso de evidências locais.' : 'Backup íntegro gerado.');
  } catch (error) {
    showToast(error.message || 'Falha ao gerar o backup.', 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

async function restoreBackup(event) {
  const input = event.target;
  try {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) throw new Error('O backup excede o limite de 50 MB.');

    if (getSyncConfig()) {
      throw new Error('Para restaurar um backup com segurança, desconecte este aparelho da sincronização primeiro. Isso evita que dados remotos antigos sejam mesclados novamente após a restauração.');
    }

    const data = JSON.parse(await file.text());
    if (!['DocInspector', 'Sky-17Gold'].includes(data.app) || !Array.isArray(data.inspections)) {
      throw new Error('Arquivo de backup inválido.');
    }
    if (data.version != null && ![1, 2, 3, 4].includes(Number(data.version))) {
      throw new Error('Este backup foi criado por uma versão incompatível do DocInspector.');
    }

    if (Number(data.version) >= 4) {
      if (data.integrity?.algorithm !== 'SHA-256' || !data.integrity?.inspections) {
        throw new Error('O backup não contém a assinatura de integridade esperada.');
      }
      const actualDigest = await sha256Hex(JSON.stringify(data.inspections));
      if (actualDigest !== data.integrity.inspections) {
        throw new Error('A verificação de integridade do backup falhou. O arquivo pode ter sido alterado ou corrompido.');
      }
    }

    const inspections = data.inspections.map(validateInspection);
    const ids = inspections.map(inspection => inspection.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('O backup contém inspeções com identificadores duplicados.');
    }

    if (!window.confirm(`Restaurar ${inspections.length} inspeção(ões) e substituir todos os dados locais atuais?`)) return;

    const localEvidence = await listEvidence();
    const localEvidenceIds = new Set(localEvidence.map(item => item.id));
    const referencedEvidenceIds = new Set();
    for (const inspection of inspections) {
      for (const document of inspection.documents) {
        for (const copy of document.fieldCopies || []) {
          if (copy.evidenceId && localEvidenceIds.has(copy.evidenceId)) {
            referencedEvidenceIds.add(copy.evidenceId);
          } else if (copy.evidenceId) {
            copy.evidenceId = null;
          }
        }
      }
    }

    await replaceAllInspections(inspections);
    for (const evidence of localEvidence) {
      if (!referencedEvidenceIds.has(evidence.id)) await deleteEvidence(evidence.id).catch(() => {});
    }
    state.inspections = await listInspections();
    state.current = null;
    state.selectedDoc = null;
    state.docsPage = 1;
    localStorage.removeItem('sky17-current');
    showToast('Backup restaurado com segurança.');
    render();
  } catch (error) {
    const message = error instanceof SyntaxError ? 'O arquivo selecionado não contém JSON válido.' : error.message;
    showToast(message || 'Falha ao restaurar o backup.', 'error');
  } finally {
    input.value = '';
  }
}

async function bindPwaActions() {
  const button = document.querySelector('#install-app');
  if (!button) return;

  button.addEventListener('click', async () => {
    const result = await requestInstall();
    if (result.status === 'accepted' || result.status === 'installed') {
      showToast('DocInspector instalado.');
      render();
      return;
    }
    if (result.status === 'ios-manual') {
      showToast('No Safari: Compartilhar → Adicionar à Tela de Início.');
      return;
    }
    if (result.status === 'dismissed') return;
    showToast('A instalação ainda não está disponível. Recarregue após o primeiro acesso online.', 'error');
  });
}

function newInspectionModal() {
  const modal = openModal(`
    <h2>Nova inspeção</h2>
    <p class="subtitle">Preencha os dados básicos e selecione a lista de documentos.</p>
    <div class="form-grid">
      <div class="field"><label for="m-project">Projeto</label><input id="m-project" maxlength="120" autocomplete="off" required></div>
      <div class="field"><label for="m-system">Sistema</label><input id="m-system" maxlength="120" autocomplete="off" required></div>
      <div class="field"><label for="m-responsible">Responsável</label><input id="m-responsible" maxlength="120" autocomplete="name" required></div>
      <div class="field"><label for="m-location">Local</label><input id="m-location" maxlength="160" autocomplete="off"></div>
      <div class="field full"><label for="m-file">Lista de documentos (.xlsx)</label><input id="m-file" type="file" accept=".xlsx,.xls" required></div>
    </div>
    <div class="actions">
      <button class="btn" data-close type="button">Cancelar</button>
      <button class="btn btn-primary" id="read-file" type="button">Continuar</button>
    </div>`, { label: 'Nova inspeção' });

  modal.querySelector('[data-close]').addEventListener('click', () => modal.closeModal());
  modal.querySelector('#read-file').addEventListener('click', () => prepareImport(modal));
  requestAnimationFrame(() => modal.querySelector('#m-project')?.focus());
}

async function prepareImport(modal) {
  const button = modal.querySelector('#read-file');
  try {
    const file = modal.querySelector('#m-file').files?.[0];
    if (!file) throw new Error('Selecione uma planilha.');

    const meta = {
      project: modal.querySelector('#m-project').value,
      system: modal.querySelector('#m-system').value,
      responsible: modal.querySelector('#m-responsible').value,
      location: modal.querySelector('#m-location').value
    };

    if (!meta.project.trim() || !meta.system.trim() || !meta.responsible.trim()) {
      throw new Error('Preencha projeto, sistema e responsável.');
    }

    setButtonBusy(button, true, 'Lendo planilha…');
    const parsed = await readWorkbook(file);
    state.importRows = parsed.rows;
    state.headers = parsed.headers;
    modal.closeModal();
    mappingModal(meta);
  } catch (error) {
    showToast(error.message || 'Falha ao ler a planilha.', 'error');
  } finally {
    if (modal.isConnected) setButtonBusy(button, false);
  }
}

function mappingModal(meta) {
  const headers = Array.isArray(state.headers) ? state.headers : [];
  const suggested = suggestMapping(headers);
  const options = key => `
    <option value="">Selecione</option>
    ${headers.map(header => `
      <option value="${escapeHtml(header)}" ${suggested[key] === header ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}`;

  const modal = openModal(`
    <h2>Mapeamento de colunas</h2>
    <p class="subtitle">Confirme qual coluna representa cada campo obrigatório.</p>
    <div class="form-grid">
      <div class="field"><label for="map-code">Código PW</label><select id="map-code">${options('code')}</select></div>
      <div class="field"><label for="map-description">Descrição</label><select id="map-description">${options('description')}</select></div>
      <div class="field"><label for="map-status">Status</label><select id="map-status">${options('status')}</select></div>
      <div class="field"><label for="map-revision">Revisão</label><select id="map-revision">${options('expectedRevision')}</select></div>
    </div>
    <div class="actions">
      <button class="btn" data-close type="button">Cancelar</button>
      <button class="btn btn-primary" id="finish-import" type="button">Criar inspeção</button>
    </div>`, { label: 'Mapeamento de colunas' });

  modal.querySelector('[data-close]').addEventListener('click', () => modal.closeModal());
  modal.querySelector('#finish-import').addEventListener('click', () => finishImport(modal, meta));
}

async function finishImport(modal, meta) {
  const button = modal.querySelector('#finish-import');
  try {
    const mapping = {
      code: modal.querySelector('#map-code').value,
      description: modal.querySelector('#map-description').value,
      status: modal.querySelector('#map-status').value,
      expectedRevision: modal.querySelector('#map-revision').value
    };

    if (Object.values(mapping).some(value => !value)) {
      throw new Error('Mapeie todas as colunas.');
    }

    setButtonBusy(button, true, 'Criando…');
    const inspection = createInspection(meta);
    inspection.documents = mapRows(state.importRows, mapping);
    await saveInspection(inspection);
    if (!state.inspections.some(item => item.id === inspection.id)) state.inspections.unshift(inspection);
    await refreshInspectionList({ required: false });
    syncNow({ announce: true }).catch(() => {});

    state.current = inspection;
    state.selectedDoc = null;
    state.importRows = null;
    state.headers = null;
    state.docsPage = 1;
    state.selectedInspectionId = inspection.id;
    state.view = 'home';
    localStorage.setItem('sky17-current', inspection.id);

    modal.closeModal();
    showToast('Inspeção criada com sucesso.');
    render();
  } catch (error) {
    showToast(error.message || 'Falha ao criar a inspeção.', 'error');
  } finally {
    if (modal.isConnected) setButtonBusy(button, false);
  }
}

boot().catch(error => {
  app.innerHTML = `<div class="main"><div class="alert">Falha ao iniciar: ${escapeHtml(error.message)}</div></div>`;
});
