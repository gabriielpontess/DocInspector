import { getInspection, listInspections } from './db.js';
import { normalizeCode } from './domain.js';
import { buildInspectionExportData } from './xlsx.js';
import { exportInspectionPdf } from './report.js';
import { escapeHtml, setButtonBusy, showToast } from './ui.js';

let observer = null;
let scheduled = false;
let activeInspectionActionSheet = null;
let activeExportInspectionId = null;
let verificationScopeLoading = false;
let verificationScopeId = (() => {
  try { return sessionStorage.getItem('docinspector-verification-scope') || ''; }
  catch { return ''; }
})();

function setVerificationScope(value) {
  verificationScopeId = String(value || '');
  try {
    if (verificationScopeId) sessionStorage.setItem('docinspector-verification-scope', verificationScopeId);
    else sessionStorage.removeItem('docinspector-verification-scope');
  } catch {}
}

function currentVerificationScope() {
  return document.querySelector('#verification-scope')?.value ?? verificationScopeId;
}

function scheduleRefinement() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    refineUi();
  });
}

function ensureInspectionActionSheetStyles() {
  if (document.querySelector('#inspection-action-sheet-styles')) return;
  const style = document.createElement('style');
  style.id = 'inspection-action-sheet-styles';
  style.textContent = `
    .inspection-action-host > .inspection-menu-popover { display: none !important; }
    .inspection-action-sheet-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1200;
      display: grid;
      place-items: end center;
      padding: 16px;
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
      background: rgba(7, 26, 49, .34);
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
    }
    .inspection-action-sheet {
      width: min(520px, 100%);
      max-height: min(78dvh, 620px);
      overflow: auto;
      padding: 10px;
      border: 1px solid var(--color-border);
      border-radius: 18px;
      background: var(--color-surface);
      box-shadow: var(--shadow-overlay-v2);
    }
    .inspection-action-sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 8px 10px 12px;
      border-bottom: 1px solid var(--color-border);
    }
    .inspection-action-sheet-head > div { min-width: 0; }
    .inspection-action-sheet-head small {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      color: var(--color-text-secondary);
      font-size: var(--text-xs);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inspection-action-sheet-list {
      display: grid;
      gap: 4px;
      padding: 8px 0;
    }
    .inspection-action-sheet .inspection-menu-option {
      display: block;
      width: 100%;
      min-height: 50px;
      padding: 0 14px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      text-align: left;
      font-size: var(--text-md);
      font-weight: 650;
      touch-action: manipulation;
    }
    .inspection-action-sheet .inspection-menu-option:active,
    .inspection-action-sheet .inspection-menu-option:focus-visible {
      background: var(--color-surface-subtle);
    }
    .inspection-action-sheet .inspection-menu-option.danger {
      margin-top: 4px;
      padding-top: 0;
      border-top: 1px solid var(--color-border);
      color: var(--color-danger);
    }
    .inspection-action-sheet-cancel {
      width: 100%;
      min-height: 48px;
    }
    body.inspection-action-sheet-open { overflow: hidden; }

    .verification-scope-control {
      grid-column: 1 / -1;
      grid-row: 3;
      display: grid;
      grid-template-columns: minmax(150px, 220px) minmax(0, 1fr);
      gap: 8px 14px;
      align-items: center;
      margin-bottom: 12px;
      padding: 12px 14px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control-v2);
      background: var(--color-surface-subtle);
    }
    .verification-scope-control label {
      color: var(--color-text);
      font-size: var(--text-sm);
      font-weight: 700;
    }
    .verification-scope-control select {
      width: 100%;
      min-height: 44px;
      background: var(--color-surface);
    }
    .verification-scope-control small {
      grid-column: 1 / -1;
      color: var(--color-text-tertiary);
      font-size: var(--text-xs);
      line-height: 1.45;
    }
    .locate-card .global-search-box #pw-search,
    .locate-card .global-search-box #clear-pw-search,
    .locate-card .global-search-box #find-pw,
    .locate-card .scan-actions #scan-document { grid-row: 4 !important; }
    .locate-card .search-field-help { grid-row: 5 !important; }
    .locate-card #pw-suggestions { grid-row: 6 !important; }
    .locate-card .scan-actions .field-help { grid-row: 7 !important; }
    .search-suggestion[hidden] { display: none !important; }
    .scope-search-empty {
      padding: 12px 14px;
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius-control-v2);
      color: var(--color-text-secondary);
      background: var(--color-surface-subtle);
      font-size: var(--text-sm);
    }

    .document-detail-navigation {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin: -4px 0 18px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--color-border);
    }
    .document-detail-navigation .document-position {
      min-width: 76px;
      color: var(--color-text-secondary);
      text-align: center;
      font-size: var(--text-sm);
      font-weight: 650;
    }

    .export-field-evidence-option {
      margin-top: 14px;
      padding: 14px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius-control-v2);
      background: var(--color-surface-subtle);
    }
    .export-field-evidence-option label {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      cursor: pointer;
    }
    .export-field-evidence-option input { margin-top: 3px; }
    .export-field-evidence-option strong { display: block; }
    .export-field-evidence-option small {
      display: block;
      margin-top: 3px;
      color: var(--color-text-secondary);
      line-height: 1.45;
    }

    @media (min-width: 768px) {
      .inspection-action-sheet-backdrop { place-items: center; }
      .inspection-action-sheet { width: min(440px, calc(100vw - 48px)); }
    }
    @media (max-width: 767px) {
      .verification-scope-control { grid-template-columns: 1fr; }
      .verification-scope-control small { grid-column: 1; }
      .document-detail-navigation { justify-content: space-between; }
    }
  `;
  document.head.append(style);
}

function closeInspectionActionSheet({ restoreFocus = true } = {}) {
  const active = activeInspectionActionSheet;
  if (!active) return;
  activeInspectionActionSheet = null;

  for (const [button, handler] of active.actionHandlers) {
    button.removeEventListener('click', handler);
  }

  if (active.popover?.isConnected) {
    active.buttons.forEach(button => active.popover.appendChild(button));
  }

  active.trigger?.setAttribute('aria-expanded', 'false');
  active.backdrop.remove();
  document.body.classList.remove('inspection-action-sheet-open');

  if (restoreFocus && active.trigger?.isConnected) active.trigger.focus();
}

function openInspectionActionSheet(trigger, host, card) {
  closeInspectionActionSheet({ restoreFocus: false });

  const popover = host.querySelector('.inspection-menu-popover');
  const buttons = popover ? [...popover.querySelectorAll('.inspection-menu-option')] : [];
  if (!popover || !buttons.length) return;

  const system = card?.querySelector('.inspection-system-title')?.textContent?.trim() || 'Inspeção';
  const listName = card?.querySelector('.inspection-list-name')?.textContent?.trim() || '';
  const backdrop = document.createElement('div');
  backdrop.className = 'inspection-action-sheet-backdrop';
  backdrop.innerHTML = `
    <section class="inspection-action-sheet" role="dialog" aria-modal="true" aria-label="Ações da inspeção">
      <div class="inspection-action-sheet-head">
        <div><strong>Ações da inspeção</strong><small></small></div>
        <button class="icon-button" data-inspection-action-close type="button" aria-label="Fechar">×</button>
      </div>
      <div class="inspection-action-sheet-list" role="menu"></div>
      <button class="btn inspection-action-sheet-cancel" data-inspection-action-close type="button">Cancelar</button>
    </section>`;

  const subtitle = backdrop.querySelector('.inspection-action-sheet-head small');
  if (subtitle) subtitle.textContent = listName ? `${system} · ${listName}` : system;
  const list = backdrop.querySelector('.inspection-action-sheet-list');
  const actionHandlers = [];

  buttons.forEach(button => {
    list.appendChild(button);
    const handler = event => {
      event.stopPropagation();
      queueMicrotask(() => closeInspectionActionSheet({ restoreFocus: false }));
    };
    button.addEventListener('click', handler);
    actionHandlers.push([button, handler]);
  });

  activeInspectionActionSheet = { backdrop, trigger, host, popover, buttons, actionHandlers };
  trigger.setAttribute('aria-expanded', 'true');
  document.body.classList.add('inspection-action-sheet-open');
  document.body.append(backdrop);

  backdrop.addEventListener('click', event => {
    if (event.target === backdrop || event.target.closest('[data-inspection-action-close]')) {
      event.preventDefault();
      closeInspectionActionSheet();
    }
  });
  backdrop.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeInspectionActionSheet();
  });

  requestAnimationFrame(() => backdrop.querySelector('.inspection-menu-option')?.focus());
}

function refineInspectionActionMenus() {
  if (activeInspectionActionSheet && !activeInspectionActionSheet.host?.isConnected) {
    closeInspectionActionSheet({ restoreFocus: false });
  }

  document.querySelectorAll('.inspection-item[data-open-inspection]').forEach(card => {
    const nativeMenu = card.querySelector('details.inspection-more-menu');
    if (!nativeMenu) return;

    const summary = nativeMenu.querySelector('summary.inspection-more-button');
    const popover = nativeMenu.querySelector('.inspection-menu-popover');
    if (!summary || !popover) return;

    const host = document.createElement('div');
    host.className = 'inspection-more-menu inspection-action-host';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'inspection-more-button';
    trigger.setAttribute('aria-label', summary.getAttribute('aria-label') || 'Mais opções da inspeção');
    trigger.setAttribute('title', summary.getAttribute('title') || 'Mais opções');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.textContent = '⋮';

    host.append(trigger, popover);
    nativeMenu.replaceWith(host);

    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openInspectionActionSheet(trigger, host, card);
    });
    trigger.addEventListener('keydown', event => event.stopPropagation());
  });
}

async function ensureVerificationScope() {
  const card = document.querySelector('.locate-card');
  const box = card?.querySelector('.global-search-box');
  if (!card || !box) return;

  let control = card.querySelector('.verification-scope-control');
  if (!control) {
    control = document.createElement('div');
    control.className = 'verification-scope-control';
    control.innerHTML = `
      <label for="verification-scope">Buscar documentos em</label>
      <select id="verification-scope" aria-label="Escolher lista para a busca de verificação">
        <option value="">Todas as inspeções (global)</option>
      </select>
      <small>Este filtro limita a busca por Código PW e descrição. A identificação por câmera continua global para preservar o fluxo de OCR já homologado.</small>`;
    box.insertAdjacentElement('beforebegin', control);

    const select = control.querySelector('#verification-scope');
    select.addEventListener('change', () => {
      setVerificationScope(select.value);
      const clear = card.querySelector('#clear-pw-search');
      clear?.click();
      filterScopedSuggestions();
      syncSearchPresentation();
    });
  }

  const select = control.querySelector('#verification-scope');
  if (!select || verificationScopeLoading || select.dataset.loaded === '1') {
    filterScopedSuggestions();
    return;
  }

  verificationScopeLoading = true;
  try {
    const inspections = await listInspections();
    if (!select.isConnected) return;
    const availableIds = new Set(inspections.map(item => item.id));
    if (verificationScopeId && !availableIds.has(verificationScopeId)) setVerificationScope('');
    select.innerHTML = `<option value="">Todas as inspeções (global)</option>${inspections.map(item => {
      const id = escapeHtml(String(item.id || ''));
      const system = escapeHtml(String(item.system || 'Sem sistema'));
      const name = escapeHtml(String(item.name || item.project || 'Inspeção'));
      return `<option value="${id}">${system} · ${name}</option>`;
    }).join('')}`;
    select.value = verificationScopeId;
    select.dataset.loaded = '1';
  } finally {
    verificationScopeLoading = false;
  }
  filterScopedSuggestions();
  syncSearchPresentation();
}

function visibleScopedSuggestions() {
  const scope = currentVerificationScope();
  return [...document.querySelectorAll('#pw-suggestions [data-search-doc][data-search-inspection]')]
    .filter(button => !scope || button.dataset.searchInspection === scope);
}

function filterScopedSuggestions() {
  const container = document.querySelector('#pw-suggestions');
  const input = document.querySelector('#pw-search');
  if (!container || !input) return;
  const scope = currentVerificationScope();
  const buttons = [...container.querySelectorAll('[data-search-doc][data-search-inspection]')];
  let visible = 0;
  buttons.forEach(button => {
    const hidden = Boolean(scope && button.dataset.searchInspection !== scope);
    button.hidden = hidden;
    if (!hidden) visible += 1;
  });

  container.querySelector('.scope-search-empty')?.remove();
  const query = input.value.trim();
  if (scope && query.length >= 2 && buttons.length && visible === 0) {
    const empty = document.createElement('div');
    empty.className = 'scope-search-empty';
    empty.textContent = 'Nenhum documento correspondente foi encontrado na lista selecionada.';
    container.append(empty);
  }
}

function syncSearchPresentation() {
  const card = document.querySelector('.locate-card');
  const input = card?.querySelector('#pw-search');
  const box = card?.querySelector('.global-search-box');
  const suggestions = card?.querySelector('#pw-suggestions');
  if (!card || !input || !box || !suggestions) return;

  input.placeholder = 'Digite para localizar…';
  const scoped = Boolean(currentVerificationScope());
  const kicker = card.querySelector('.section-title .section-kicker');
  if (kicker) kicker.textContent = scoped ? 'BUSCA POR LISTA' : 'BUSCA GLOBAL';
  const intro = card.querySelector(':scope > p.subtitle');
  if (intro) intro.textContent = scoped
    ? 'Localize rapidamente um documento somente na lista de inspeção selecionada.'
    : 'Localize rapidamente um documento em qualquer inspeção cadastrada.';

  let help = card.querySelector('.search-field-help');
  if (!help) {
    help = document.createElement('small');
    help.className = 'search-field-help';
    help.textContent = 'Pesquise por Código PW ou por palavras da descrição.';
    box.insertAdjacentElement('afterend', help);
  }

  const applyEmptyState = () => {
    const empty = !input.value.trim();
    if (empty) {
      suggestions.replaceChildren();
      suggestions.hidden = true;
    } else {
      suggestions.hidden = false;
      filterScopedSuggestions();
    }
  };

  if (!input.dataset.refinementBound) {
    input.dataset.refinementBound = '1';
    input.addEventListener('input', () => queueMicrotask(applyEmptyState));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') queueMicrotask(applyEmptyState);
    });
  }

  const clear = card.querySelector('#clear-pw-search');
  if (clear && !clear.dataset.refinementBound) {
    clear.dataset.refinementBound = '1';
    clear.addEventListener('click', () => queueMicrotask(applyEmptyState));
  }

  applyEmptyState();
}

function handleScopedSearchAction(event) {
  const isEnter = event.type === 'keydown' && event.target?.id === 'pw-search' && event.key === 'Enter';
  const isButton = event.type === 'click' && event.target?.closest?.('#find-pw');
  if (!isEnter && !isButton) return;
  const scope = currentVerificationScope();
  if (!scope) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  queueMicrotask(() => {
    filterScopedSuggestions();
    const input = document.querySelector('#pw-search');
    const query = input?.value || '';
    const normalized = normalizeCode(query);
    if (!normalized) {
      showToast('Digite um Código PW ou parte da descrição.', 'error');
      input?.focus();
      return;
    }

    const visible = visibleScopedSuggestions();
    const exact = visible.filter(button => normalizeCode(button.querySelector('.search-suggestion-code')?.textContent || '') === normalized);
    if (exact.length === 1) {
      exact[0].click();
      return;
    }
    if (exact.length > 1) {
      showToast('Este Código PW aparece mais de uma vez na lista selecionada. Revise a lista antes de registrar.', 'error');
      return;
    }
    if (visible.length) showToast('Há documentos correspondentes nesta lista. Selecione uma sugestão para abrir o registro.');
    else showToast('Documento não localizado na lista selecionada.', 'error');
    input?.focus();
  });
}

function openDocumentFromSequence(documentRecord, inspectionId) {
  const input = document.querySelector('#pw-search');
  if (!input || !documentRecord) return;
  input.value = documentRecord.code || '';
  input.dispatchEvent(new Event('input', { bubbles: true }));

  requestAnimationFrame(() => {
    const exactSuggestion = [...document.querySelectorAll('[data-search-doc][data-search-inspection]')]
      .find(button => button.dataset.searchDoc === documentRecord.id && button.dataset.searchInspection === inspectionId);
    if (exactSuggestion) exactSuggestion.click();
    else document.querySelector('#find-pw')?.click();
  });
}

async function refineDocumentNavigation() {
  const detail = document.querySelector('.doc-detail');
  const heading = detail?.querySelector('.doc-heading');
  const next = heading?.querySelector('#next-document');
  const code = heading?.querySelector('h2')?.textContent?.trim();
  const inspectionId = localStorage.getItem('sky17-current');
  if (!heading || !next || !code || !inspectionId) return;

  let previous = heading.querySelector('#previous-document');
  if (!previous) {
    previous = document.createElement('button');
    previous.id = 'previous-document';
    previous.type = 'button';
    previous.className = 'icon-button previous-document-button';
    previous.setAttribute('aria-label', 'Documento anterior da lista');
    previous.title = 'Documento anterior';
    previous.innerHTML = '<span aria-hidden="true">‹</span>';
    next.insertAdjacentElement('beforebegin', previous);
  }

  const inspection = await getInspection(inspectionId).catch(() => null);
  if (!inspection || !heading.isConnected) return;
  const documents = inspection.documents || [];
  const index = documents.findIndex(item => String(item.code || '').trim() === code);
  if (index < 0) return;

  previous.disabled = index === 0;
  next.disabled = index === documents.length - 1;
  next.title = 'Próximo documento';

  if (!previous.dataset.bound) {
    previous.dataset.bound = '1';
    previous.addEventListener('click', async () => {
      const latest = await getInspection(inspectionId).catch(() => null);
      const currentCode = document.querySelector('.doc-detail .doc-heading h2')?.textContent?.trim();
      const list = latest?.documents || [];
      const currentIndex = list.findIndex(item => String(item.code || '').trim() === currentCode);
      if (currentIndex <= 0) return;
      openDocumentFromSequence(list[currentIndex - 1], inspectionId);
    });
  }
}

function openDocumentDetailThroughCatalog(documentId, inspectionId) {
  const backToDocuments = document.querySelector('.document-page [data-nav="docs"]');
  if (!backToDocuments) return;
  backToDocuments.click();
  requestAnimationFrame(() => {
    const body = document.querySelector('#docs-body');
    if (!body) return;
    const proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.hidden = true;
    proxy.dataset.docDetails = documentId;
    proxy.dataset.inspectionDetails = inspectionId;
    body.append(proxy);
    proxy.click();
    proxy.remove();
  });
}

async function refineDocumentDetailNavigation() {
  const page = document.querySelector('.document-page');
  const heading = page?.querySelector('.doc-heading');
  const code = heading?.querySelector('h2')?.textContent?.trim();
  const inspectionId = localStorage.getItem('sky17-current');
  if (!page || !heading || !code || !inspectionId) return;

  const inspection = await getInspection(inspectionId).catch(() => null);
  if (!inspection || !page.isConnected) return;
  const documents = inspection.documents || [];
  const index = documents.findIndex(item => String(item.code || '').trim() === code);
  if (index < 0) return;

  let nav = page.querySelector('.document-detail-navigation');
  if (!nav) {
    nav = document.createElement('div');
    nav.className = 'document-detail-navigation';
    nav.setAttribute('aria-label', 'Navegação entre documentos da inspeção');
    nav.innerHTML = `
      <button class="icon-button previous-document-button" id="detail-previous-document" type="button" aria-label="Documento anterior" title="Documento anterior"><span aria-hidden="true">‹</span></button>
      <span class="document-position" aria-live="polite"></span>
      <button class="icon-button next-document-button" id="detail-next-document" type="button" aria-label="Próximo documento" title="Próximo documento"><span aria-hidden="true">›</span></button>`;
    heading.insertAdjacentElement('afterend', nav);
  }

  const previous = nav.querySelector('#detail-previous-document');
  const next = nav.querySelector('#detail-next-document');
  const position = nav.querySelector('.document-position');
  previous.disabled = index === 0;
  next.disabled = index === documents.length - 1;
  if (position) position.textContent = `${index + 1} de ${documents.length}`;

  if (!previous.dataset.bound) {
    previous.dataset.bound = '1';
    previous.addEventListener('click', async () => {
      const latest = await getInspection(inspectionId).catch(() => null);
      const currentCode = document.querySelector('.document-page .doc-heading h2')?.textContent?.trim();
      const list = latest?.documents || [];
      const currentIndex = list.findIndex(item => String(item.code || '').trim() === currentCode);
      if (currentIndex <= 0) return;
      openDocumentDetailThroughCatalog(list[currentIndex - 1].id, inspectionId);
    });
  }
  if (!next.dataset.bound) {
    next.dataset.bound = '1';
    next.addEventListener('click', async () => {
      const latest = await getInspection(inspectionId).catch(() => null);
      const currentCode = document.querySelector('.document-page .doc-heading h2')?.textContent?.trim();
      const list = latest?.documents || [];
      const currentIndex = list.findIndex(item => String(item.code || '').trim() === currentCode);
      if (currentIndex < 0 || currentIndex >= list.length - 1) return;
      openDocumentDetailThroughCatalog(list[currentIndex + 1].id, inspectionId);
    });
  }
}

function rememberExportInspection(event) {
  const direct = event.target?.closest?.('[data-export-inspection]');
  if (direct?.dataset.exportInspection) {
    activeExportInspectionId = direct.dataset.exportInspection;
    queueMicrotask(ensurePdfCopiesOption);
    return;
  }
  if (event.target?.closest?.('#export-selected-inspection')) {
    activeExportInspectionId = document.querySelector('#filter-inspection')?.value || localStorage.getItem('sky17-current') || null;
    queueMicrotask(ensurePdfCopiesOption);
  }
}

function ensurePdfCopiesOption() {
  const generatePdf = document.querySelector('#generate-pdf');
  const modal = generatePdf?.closest('.modal') || generatePdf?.closest('[role="dialog"]');
  if (!generatePdf || !modal || modal.querySelector('#exp-pdf-copies')) return;
  const note = modal.querySelector('.export-format-note');
  const section = document.createElement('section');
  section.className = 'export-field-evidence-option';
  section.innerHTML = `
    <label for="exp-pdf-copies">
      <input type="checkbox" id="exp-pdf-copies">
      <span><strong>Incluir cópias de campo no PDF</strong><small>Opcional. Acrescenta revisão encontrada, origem, marcações e comentários das cópias físicas. O relatório principal permanece com uma única linha por Código PW.</small></span>
    </label>`;
  if (note) note.insertAdjacentElement('beforebegin', section);
  else generatePdf.closest('.actions')?.insertAdjacentElement('beforebegin', section);
}

async function resolveExportInspection(modal) {
  const preferredId = activeExportInspectionId || localStorage.getItem('sky17-current');
  if (preferredId) {
    const preferred = await getInspection(preferredId).catch(() => null);
    if (preferred) return preferred;
  }

  const system = modal.querySelector('.export-report-preview strong')?.textContent?.trim() || '';
  const listName = modal.querySelector('.export-report-preview small')?.textContent?.trim() || '';
  const inspections = await listInspections();
  const matches = inspections.filter(item => String(item.system || 'Sem sistema') === system && String(item.name || item.project || '') === listName);
  return matches.length === 1 ? matches[0] : null;
}

async function generateRefinedPdf(button) {
  const modal = button.closest('.modal') || button.closest('[role="dialog"]');
  if (!modal) return;
  try {
    setButtonBusy(button, true, 'Gerando PDF…');
    const inspection = await resolveExportInspection(modal);
    if (!inspection) throw new Error('Não foi possível identificar com segurança a inspeção que será exportada.');
    const checked = id => Boolean(modal.querySelector(`#${id}`)?.checked);
    const options = {
      includeConforming: checked('exp-conforming'),
      includeNonconforming: checked('exp-nonconforming'),
      includeNotFound: checked('exp-notfound'),
      includePending: checked('exp-pending'),
      includeSummary: true,
      includeDocuments: true,
      includeCopies: checked('exp-pdf-copies'),
      includeComments: true,
      includeMarkings: true,
      includeEvidence: true
    };
    if (!options.includeConforming && !options.includeNonconforming && !options.includeNotFound && !options.includePending) {
      throw new Error('Selecione pelo menos um resultado para exportar.');
    }
    const data = buildInspectionExportData(inspection, options);
    exportInspectionPdf(inspection, data);
    showToast(options.includeCopies ? 'PDF com cópias de campo gerado.' : 'PDF principal gerado sem a seção de cópias de campo.');
    modal.querySelector('[data-close]')?.click();
  } catch (error) {
    showToast(error.message || 'Falha ao gerar PDF.', 'error');
  } finally {
    if (button?.isConnected) setButtonBusy(button, false);
  }
}

function handleGlobalCaptureClick(event) {
  rememberExportInspection(event);
  handleScopedSearchAction(event);
  const pdfButton = event.target?.closest?.('#generate-pdf');
  if (!pdfButton) return;
  ensurePdfCopiesOption();
  if (!pdfButton.closest('.modal')?.querySelector('#exp-pdf-copies') && !pdfButton.closest('[role="dialog"]')?.querySelector('#exp-pdf-copies')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void generateRefinedPdf(pdfButton);
}

function clarifyExpectedRevisionStatus() {
  const label = document.querySelector('label[for="doc-status"]');
  const input = document.querySelector('#doc-status');
  if (label) label.textContent = 'Status da revisão esperada';
  if (input) input.closest('.field')?.classList.add('expected-status-field');
}

function refineUi() {
  ensureInspectionActionSheetStyles();
  refineInspectionActionMenus();
  void ensureVerificationScope();
  syncSearchPresentation();
  filterScopedSuggestions();
  clarifyExpectedRevisionStatus();
  void refineDocumentNavigation();
  void refineDocumentDetailNavigation();
  ensurePdfCopiesOption();
}

function start() {
  refineUi();
  const app = document.querySelector('#app');
  if (!app || observer) return;
  observer = new MutationObserver(scheduleRefinement);
  observer.observe(app, { childList: true, subtree: true });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeInspectionActionSheet) closeInspectionActionSheet();
  });
  document.addEventListener('keydown', handleScopedSearchAction, true);
  document.addEventListener('click', handleGlobalCaptureClick, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
