import { getInspection } from './db.js';

let observer = null;
let scheduled = false;

function scheduleRefinement() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    refineUi();
  });
}

function stopCardPropagation(element) {
  element.addEventListener('click', event => event.stopPropagation());
  element.addEventListener('keydown', event => event.stopPropagation());
}

function closeInspectionMenus(except = null) {
  document.querySelectorAll('.inspection-more-menu[open]').forEach(menu => {
    if (menu !== except) menu.removeAttribute('open');
  });
}

function refineInspectionActions(root = document) {
  root.querySelectorAll('.inspection-item[data-open-inspection]').forEach(card => {
    const actions = card.querySelector('.inspection-actions');
    if (!actions) return;

    const viewButton = actions.querySelector('[data-view-inspection]');
    if (viewButton) viewButton.classList.add('inspection-primary-action');

    let details = actions.querySelector('.inspection-more-menu');
    if (!details) {
      details = document.createElement('details');
      details.className = 'inspection-more-menu';
      details.innerHTML = `
        <summary class="inspection-more-button" aria-label="Mais opções da inspeção" title="Mais opções">⋮</summary>
        <div class="inspection-menu-popover" role="menu"></div>`;
      stopCardPropagation(details);
      details.addEventListener('toggle', () => {
        if (details.open) closeInspectionMenus(details);
      });
      actions.appendChild(details);
    }

    const popover = details.querySelector('.inspection-menu-popover');
    if (!popover) return;

    const sources = [
      ['edit', actions.querySelector('[data-edit-inspection]'), 'Editar'],
      ['update', actions.querySelector('[data-update-inspection-list]'), 'Atualizar lista'],
      ['export', actions.querySelector('[data-export-inspection]'), 'Exportar'],
      ['delete', actions.querySelector('[data-delete]'), 'Excluir']
    ].filter(([, button]) => Boolean(button));

    for (const [key, button, label] of sources) {
      button.className = `inspection-menu-option${key === 'delete' ? ' danger' : ''}`;
      button.removeAttribute('aria-hidden');
      button.removeAttribute('tabindex');
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      if (button.parentElement !== popover) popover.appendChild(button);
    }
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
  refineInspectionActions();
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

  document.addEventListener('click', event => {
    if (!event.target.closest('.inspection-more-menu')) closeInspectionMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeInspectionMenus();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
