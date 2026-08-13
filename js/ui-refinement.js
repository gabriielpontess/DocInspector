import { getInspection } from './db.js';

let observer = null;
let scheduled = false;
let activeInspectionActionSheet = null;

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
    @media (min-width: 768px) {
      .inspection-action-sheet-backdrop { place-items: center; }
      .inspection-action-sheet { width: min(440px, calc(100vw - 48px)); }
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

function syncSearchPresentation() {
  const card = document.querySelector('.locate-card');
  const input = card?.querySelector('#pw-search');
  const box = card?.querySelector('.global-search-box');
  const suggestions = card?.querySelector('#pw-suggestions');
  if (!card || !input || !box || !suggestions) return;

  input.placeholder = 'Digite para localizar…';

  const intro = card.querySelector(':scope > p.subtitle');
  if (intro) intro.textContent = 'Localize rapidamente um documento em qualquer inspeção cadastrada.';

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
  const heading = document.querySelector('.doc-heading');
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
      const currentCode = document.querySelector('.doc-heading h2')?.textContent?.trim();
      const list = latest?.documents || [];
      const currentIndex = list.findIndex(item => String(item.code || '').trim() === currentCode);
      if (currentIndex <= 0) return;
      openDocumentFromSequence(list[currentIndex - 1], inspectionId);
    });
  }
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
  syncSearchPresentation();
  clarifyExpectedRevisionStatus();
  refineDocumentNavigation();
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
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
