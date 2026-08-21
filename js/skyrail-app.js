import { clearAuthContext, resolveAuthContext } from './auth-context.js';
import { signInWithEmailPassword, signOutCurrentSession } from './auth.js';
import { listCachedSkyrailDocuments } from './skyrail-db.js';
import {
  createSkyrailDocument,
  listAdminSkyrailDocuments,
  updateSkyrailDocument
} from './skyrail-api.js';
import {
  listSkyrailDisciplines,
  matchesSkyrailDocument,
  sortSkyrailDocuments
} from './skyrail-model.js';
import {
  ensureSkyrailDocumentOffline,
  getSkyrailLastSync,
  syncSkyrailDocuments
} from './skyrail-sync.js';
import { createSkyrailPdfViewer } from './skyrail-pdf-viewer.js';

const root = document.getElementById('skyrail-app');
const toastRoot = document.getElementById('skyrail-toast');

const state = {
  context: null,
  documents: [],
  query: '',
  discipline: 'ALL',
  syncing: false,
  adminDocuments: [],
  editingDocumentId: null,
  viewer: null,
  viewerDocument: null,
  viewerPage: 1,
  viewerScale: 1.2,
  viewerRenderToken: 0
};

let toastTimer = null;

function text(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, { error = false } = {}) {
  if (!toastRoot) return;
  clearTimeout(toastTimer);
  toastRoot.textContent = text(message);
  toastRoot.classList.toggle('is-error', error);
  toastRoot.classList.add('is-visible');
  toastTimer = setTimeout(() => toastRoot.classList.remove('is-visible'), 3600);
}

function formatDateTime(value) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return 'Ainda não sincronizado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(parsed));
}

function isAdmin() {
  return state.context?.role === 'ADMIN';
}

function renderLogin(message = '') {
  const offlineHint = navigator.onLine
    ? 'Use sua conta autorizada para acessar a biblioteca.'
    : 'Sem internet. O acesso offline exige que esta conta já tenha sido validada anteriormente neste aparelho.';

  root.innerHTML = `
    <main class="skyrail-login-shell">
      <section class="skyrail-login-card" aria-labelledby="login-title">
        <div class="skyrail-brand">
          <div class="skyrail-brand-mark">BYD</div>
          <div>
            <h1 id="login-title">BYD Skyrail</h1>
            <p>Documentação oficial em campo</p>
          </div>
        </div>
        <p class="skyrail-info">${escapeHtml(offlineHint)}</p>
        ${message ? `<p class="skyrail-error">${escapeHtml(message)}</p>` : ''}
        <form id="skyrail-login-form">
          <label class="skyrail-field">
            <span>E-mail</span>
            <input name="email" type="email" autocomplete="username" required>
          </label>
          <label class="skyrail-field">
            <span>Senha</span>
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button class="skyrail-btn skyrail-btn-primary" type="submit" ${navigator.onLine ? '' : 'disabled'}>Entrar</button>
        </form>
      </section>
    </main>`;

  root.querySelector('#skyrail-login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const data = new FormData(form);
      await signInWithEmailPassword(data.get('email'), data.get('password'));
      await bootstrapAuthenticated();
    } catch (error) {
      renderLogin(error?.message || 'Não foi possível entrar.');
    } finally {
      if (submit?.isConnected) submit.disabled = false;
    }
  });
}

function renderShell() {
  const context = state.context;
  root.innerHTML = `
    <div class="skyrail-app-shell">
      <header class="skyrail-header">
        <div class="skyrail-brand">
          <div class="skyrail-brand-mark">BYD</div>
          <div>
            <h1>BYD Skyrail</h1>
            <p>${escapeHtml(context.workspaceName)} · ${escapeHtml(context.displayName)}</p>
          </div>
        </div>
        <div class="skyrail-header-actions">
          <span id="skyrail-connectivity" class="skyrail-connectivity"></span>
          ${isAdmin() ? '<button id="skyrail-admin" class="skyrail-btn skyrail-btn-ghost" type="button"><span>Administrar</span></button>' : ''}
          <button id="skyrail-sync" class="skyrail-btn skyrail-btn-primary" type="button"><span>Sincronizar</span> ↻</button>
          <button id="skyrail-logout" class="skyrail-btn skyrail-btn-ghost" type="button" aria-label="Sair"><span>Sair</span></button>
        </div>
      </header>

      <main class="skyrail-main">
        <section class="skyrail-summary">
          <div>
            <h2>Documentos</h2>
            <p>Consulte a revisão disponibilizada para uso em campo.</p>
          </div>
          <div id="skyrail-sync-meta" class="skyrail-sync-meta"></div>
        </section>

        <section class="skyrail-toolbar" aria-label="Pesquisa de documentos">
          <input id="skyrail-search" class="skyrail-search" type="search" placeholder="Buscar por código ou título..." autocomplete="off">
          <button id="skyrail-sync-secondary" class="skyrail-btn skyrail-btn-dark" type="button">Sincronizar agora</button>
        </section>
        <div id="skyrail-disciplines" class="skyrail-disciplines" aria-label="Filtro por disciplina"></div>
        <section id="skyrail-list" class="skyrail-list"></section>
      </main>
    </div>`;

  root.querySelector('#skyrail-search')?.addEventListener('input', event => {
    state.query = event.target.value || '';
    renderLibrary();
  });

  root.querySelector('#skyrail-disciplines')?.addEventListener('click', event => {
    const button = event.target.closest('[data-discipline]');
    if (!button) return;
    state.discipline = button.dataset.discipline || 'ALL';
    renderLibrary();
  });

  root.querySelector('#skyrail-list')?.addEventListener('click', event => {
    const card = event.target.closest('[data-document-id]');
    if (card) openDocument(card.dataset.documentId);
  });

  root.querySelector('#skyrail-sync')?.addEventListener('click', () => syncNow());
  root.querySelector('#skyrail-sync-secondary')?.addEventListener('click', () => syncNow());
  root.querySelector('#skyrail-admin')?.addEventListener('click', () => openAdmin());
  root.querySelector('#skyrail-logout')?.addEventListener('click', () => logout());
  updateConnectivity();
  updateSyncMeta();
  renderLibrary();
}

function updateConnectivity() {
  const badge = root.querySelector('#skyrail-connectivity');
  if (!badge) return;
  const online = navigator.onLine;
  badge.textContent = online ? 'Online' : 'Offline';
  badge.classList.toggle('is-offline', !online);
}

function updateSyncMeta(customText = '') {
  const target = root.querySelector('#skyrail-sync-meta');
  if (!target || !state.context) return;
  if (customText) {
    target.textContent = customText;
    return;
  }
  const lastSync = getSkyrailLastSync(state.context.workspaceId);
  target.textContent = `Última sincronização: ${formatDateTime(lastSync)}`;
}

function renderLibrary() {
  const disciplineTarget = root.querySelector('#skyrail-disciplines');
  const listTarget = root.querySelector('#skyrail-list');
  if (!disciplineTarget || !listTarget) return;

  const disciplines = listSkyrailDisciplines(state.documents);
  if (state.discipline !== 'ALL' && !disciplines.includes(state.discipline)) state.discipline = 'ALL';

  disciplineTarget.innerHTML = [
    `<button class="skyrail-chip ${state.discipline === 'ALL' ? 'is-active' : ''}" type="button" data-discipline="ALL">Todos</button>`,
    ...disciplines.map(discipline => `<button class="skyrail-chip ${state.discipline === discipline ? 'is-active' : ''}" type="button" data-discipline="${escapeHtml(discipline)}">${escapeHtml(discipline)}</button>`)
  ].join('');

  const visible = state.documents.filter(document => matchesSkyrailDocument(document, {
    query: state.query,
    discipline: state.discipline
  }));

  if (!visible.length) {
    listTarget.innerHTML = `<div class="skyrail-empty">${state.documents.length ? 'Nenhum documento corresponde à pesquisa.' : 'Nenhum documento sincronizado neste aparelho.'}</div>`;
    return;
  }

  listTarget.innerHTML = visible.map(document => `
    <button class="skyrail-doc-card" type="button" data-document-id="${escapeHtml(document.id)}">
      <span>
        <span class="skyrail-doc-code">${escapeHtml(document.code)}</span>
        <span class="skyrail-doc-title">${escapeHtml(document.title)}</span>
        <span class="skyrail-doc-meta">${escapeHtml(document.discipline)} · Rev. ${escapeHtml(document.revision)}</span>
      </span>
      <span class="skyrail-doc-status ${document.blob ? '' : 'is-missing'}">${document.blob ? '✓ Offline' : '↓ Baixar'}</span>
    </button>`).join('');
}

async function reloadLocalDocuments() {
  if (!state.context) return;
  state.documents = sortSkyrailDocuments(await listCachedSkyrailDocuments(state.context.workspaceId));
  renderLibrary();
  updateSyncMeta();
}

async function syncNow({ silent = false } = {}) {
  if (!state.context || state.syncing) return;
  if (!navigator.onLine) {
    if (!silent) toast('Sem internet. Os documentos já sincronizados continuam disponíveis.', { error: true });
    return;
  }

  state.syncing = true;
  for (const button of root.querySelectorAll('#skyrail-sync, #skyrail-sync-secondary')) button.disabled = true;
  updateSyncMeta('Preparando sincronização...');

  try {
    const result = await syncSkyrailDocuments(state.context.workspaceId, {
      onProgress(progress) {
        if (progress.phase === 'document') {
          updateSyncMeta(`Sincronizando ${progress.current}/${progress.total}${progress.code ? ` · ${progress.code}` : ''}`);
        }
      }
    });
    await reloadLocalDocuments();
    if (!silent || result.downloaded > 0) {
      toast(`Sincronização concluída. ${result.total} documento(s) disponível(is), ${result.downloaded} atualizado(s).`);
    }
  } catch (error) {
    updateSyncMeta();
    toast(error?.message || 'Falha ao sincronizar a biblioteca.', { error: true });
  } finally {
    state.syncing = false;
    for (const button of root.querySelectorAll('#skyrail-sync, #skyrail-sync-secondary')) button.disabled = false;
  }
}

async function openDocument(documentId) {
  let document = state.documents.find(item => item.id === documentId) || null;
  if (!document) return;

  if (!document.blob) {
    if (!navigator.onLine) {
      toast('Este PDF ainda não foi baixado neste aparelho.', { error: true });
      return;
    }
    toast(`Baixando ${document.code}...`);
    try {
      document = await ensureSkyrailDocumentOffline(document.id);
      await reloadLocalDocuments();
    } catch (error) {
      toast(error?.message || 'Não foi possível baixar este PDF.', { error: true });
      return;
    }
  }

  await openViewer(document);
}

async function openViewer(document) {
  await closeViewer();
  const backdrop = documentCreate('div', 'skyrail-modal-backdrop');
  backdrop.id = 'skyrail-viewer-backdrop';
  backdrop.innerHTML = `
    <section class="skyrail-modal skyrail-viewer" role="dialog" aria-modal="true" aria-label="Visualizador de PDF">
      <header class="skyrail-modal-head">
        <div>
          <h2>${escapeHtml(document.code)} · Rev. ${escapeHtml(document.revision)}</h2>
          <small>${escapeHtml(document.title)}</small>
        </div>
        <button class="skyrail-btn skyrail-btn-ghost" type="button" data-viewer-action="close">Fechar</button>
      </header>
      <div class="skyrail-viewer-toolbar">
        <button class="skyrail-btn" type="button" data-viewer-action="prev">←</button>
        <span id="skyrail-viewer-page" class="skyrail-viewer-page">Página</span>
        <button class="skyrail-btn" type="button" data-viewer-action="next">→</button>
        <button class="skyrail-btn" type="button" data-viewer-action="zoom-out">−</button>
        <button class="skyrail-btn" type="button" data-viewer-action="zoom-in">+</button>
      </div>
      <div class="skyrail-canvas-wrap"><canvas id="skyrail-pdf-canvas"></canvas></div>
    </section>`;
  globalThis.document.body.append(backdrop);

  backdrop.addEventListener('click', event => {
    const action = event.target.closest('[data-viewer-action]')?.dataset.viewerAction;
    if (!action) return;
    if (action === 'close') closeViewer();
    if (action === 'prev') changeViewerPage(-1);
    if (action === 'next') changeViewerPage(1);
    if (action === 'zoom-out') changeViewerZoom(-0.2);
    if (action === 'zoom-in') changeViewerZoom(0.2);
  });

  try {
    state.viewer = await createSkyrailPdfViewer(document.blob);
    state.viewerDocument = document;
    state.viewerPage = 1;
    state.viewerScale = 1.2;
    await renderViewerPage();
  } catch (error) {
    toast(error?.message || 'Não foi possível abrir o PDF.', { error: true });
    await closeViewer();
  }
}

function documentCreate(tag, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

async function renderViewerPage() {
  const backdrop = document.getElementById('skyrail-viewer-backdrop');
  const canvas = backdrop?.querySelector('#skyrail-pdf-canvas');
  const pageLabel = backdrop?.querySelector('#skyrail-viewer-page');
  if (!state.viewer || !canvas || !pageLabel) return;

  const token = ++state.viewerRenderToken;
  pageLabel.textContent = `Página ${state.viewerPage} de ${state.viewer.numPages}`;
  const prev = backdrop.querySelector('[data-viewer-action="prev"]');
  const next = backdrop.querySelector('[data-viewer-action="next"]');
  if (prev) prev.disabled = state.viewerPage <= 1;
  if (next) next.disabled = state.viewerPage >= state.viewer.numPages;

  try {
    await state.viewer.renderPage({
      pageNumber: state.viewerPage,
      canvas,
      scale: state.viewerScale
    });
  } catch (error) {
    if (token === state.viewerRenderToken) toast(error?.message || 'Falha ao renderizar esta página.', { error: true });
  }
}

function changeViewerPage(delta) {
  if (!state.viewer) return;
  state.viewerPage = Math.min(Math.max(state.viewerPage + delta, 1), state.viewer.numPages);
  renderViewerPage();
}

function changeViewerZoom(delta) {
  if (!state.viewer) return;
  state.viewerScale = Math.min(Math.max(state.viewerScale + delta, 0.6), 2.6);
  renderViewerPage();
}

async function closeViewer() {
  state.viewerRenderToken += 1;
  const viewer = state.viewer;
  state.viewer = null;
  state.viewerDocument = null;
  document.getElementById('skyrail-viewer-backdrop')?.remove();
  if (viewer) await viewer.destroy().catch(() => {});
}

async function openAdmin() {
  if (!isAdmin()) return;
  if (!navigator.onLine) {
    toast('A administração de documentos exige conexão com a internet.', { error: true });
    return;
  }
  try {
    state.adminDocuments = await listAdminSkyrailDocuments(state.context.workspaceId);
    state.editingDocumentId = null;
    renderAdminModal();
  } catch (error) {
    toast(error?.message || 'Não foi possível abrir a administração.', { error: true });
  }
}

function renderAdminModal() {
  document.getElementById('skyrail-admin-backdrop')?.remove();
  const editing = state.adminDocuments.find(document => document.id === state.editingDocumentId) || null;
  const backdrop = documentCreate('div', 'skyrail-modal-backdrop');
  backdrop.id = 'skyrail-admin-backdrop';
  backdrop.innerHTML = `
    <section class="skyrail-modal" role="dialog" aria-modal="true" aria-label="Administração de documentos">
      <header class="skyrail-modal-head">
        <div>
          <h2>Administrar documentos</h2>
          <small>${editing ? `Editando ${escapeHtml(editing.code)}` : 'Cadastrar ou atualizar a biblioteca oficial'}</small>
        </div>
        <button class="skyrail-btn skyrail-btn-ghost" type="button" data-admin-action="close">Fechar</button>
      </header>
      <div class="skyrail-modal-body">
        <form id="skyrail-admin-form" class="skyrail-admin-form">
          <label class="skyrail-field">
            <span>Código</span>
            <input name="code" required maxlength="160" value="${escapeHtml(editing?.code || '')}">
          </label>
          <label class="skyrail-field">
            <span>Revisão</span>
            <input name="revision" required maxlength="80" value="${escapeHtml(editing?.revision || '')}">
          </label>
          <label class="skyrail-field is-wide">
            <span>Título</span>
            <input name="title" required maxlength="300" value="${escapeHtml(editing?.title || '')}">
          </label>
          <label class="skyrail-field">
            <span>Disciplina</span>
            <input name="discipline" required maxlength="160" value="${escapeHtml(editing?.discipline || '')}">
          </label>
          <label class="skyrail-field">
            <span>PDF ${editing ? '(opcional ao editar)' : ''}</span>
            <input name="file" type="file" accept="application/pdf,.pdf" ${editing ? '' : 'required'}>
          </label>
          <label class="skyrail-checkbox">
            <input name="active" type="checkbox" ${editing?.active === false ? '' : 'checked'}>
            Documento ativo
          </label>
          <div class="skyrail-admin-actions">
            ${editing ? '<button class="skyrail-btn" type="button" data-admin-action="cancel-edit">Cancelar edição</button>' : ''}
            <button class="skyrail-btn skyrail-btn-primary" type="submit">${editing ? 'Salvar alterações' : 'Cadastrar documento'}</button>
          </div>
        </form>

        <div class="skyrail-admin-list">
          ${state.adminDocuments.length ? state.adminDocuments.map(document => `
            <div class="skyrail-admin-row ${document.active ? '' : 'is-inactive'}">
              <div>
                <strong>${escapeHtml(document.code)} · Rev. ${escapeHtml(document.revision)}</strong>
                <small>${escapeHtml(document.title)} · ${escapeHtml(document.discipline)} · ${document.active ? 'Ativo' : 'Inativo'}</small>
              </div>
              <div class="skyrail-admin-row-actions">
                <button class="skyrail-btn" type="button" data-admin-action="edit" data-document-id="${escapeHtml(document.id)}">Editar</button>
                <button class="skyrail-btn ${document.active ? 'skyrail-btn-danger' : ''}" type="button" data-admin-action="toggle-active" data-document-id="${escapeHtml(document.id)}">${document.active ? 'Desativar' : 'Ativar'}</button>
              </div>
            </div>`).join('') : '<div class="skyrail-empty">Nenhum documento cadastrado.</div>'}
        </div>
      </div>
    </section>`;
  document.body.append(backdrop);

  backdrop.querySelector('#skyrail-admin-form')?.addEventListener('submit', saveAdminForm);
  backdrop.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-action]');
    if (!button) return;
    const action = button.dataset.adminAction;
    if (action === 'close') backdrop.remove();
    if (action === 'cancel-edit') {
      state.editingDocumentId = null;
      renderAdminModal();
    }
    if (action === 'edit') {
      state.editingDocumentId = button.dataset.documentId || null;
      renderAdminModal();
    }
    if (action === 'toggle-active') toggleAdminDocument(button.dataset.documentId);
  });
}

async function saveAdminForm(event) {
  event.preventDefault();
  if (!navigator.onLine) return toast('Sem internet para salvar alterações.', { error: true });
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  const editing = state.adminDocuments.find(document => document.id === state.editingDocumentId) || null;

  try {
    const data = new FormData(form);
    const file = form.elements.file?.files?.[0] || null;
    const input = {
      workspaceId: state.context.workspaceId,
      code: data.get('code'),
      title: data.get('title'),
      discipline: data.get('discipline'),
      revision: data.get('revision'),
      active: form.elements.active.checked,
      file
    };

    if (editing) {
      await updateSkyrailDocument(editing, input);
      toast('Documento atualizado.');
    } else {
      await createSkyrailDocument(input);
      toast('Documento cadastrado.');
    }

    state.editingDocumentId = null;
    state.adminDocuments = await listAdminSkyrailDocuments(state.context.workspaceId);
    renderAdminModal();
    await syncNow({ silent: true });
  } catch (error) {
    toast(error?.message || 'Não foi possível salvar o documento.', { error: true });
  } finally {
    if (submit?.isConnected) submit.disabled = false;
  }
}

async function toggleAdminDocument(documentId) {
  const document = state.adminDocuments.find(item => item.id === documentId);
  if (!document) return;
  try {
    await updateSkyrailDocument(document, {
      code: document.code,
      title: document.title,
      discipline: document.discipline,
      revision: document.revision,
      active: !document.active
    });
    state.adminDocuments = await listAdminSkyrailDocuments(state.context.workspaceId);
    renderAdminModal();
    await syncNow({ silent: true });
  } catch (error) {
    toast(error?.message || 'Não foi possível alterar o estado do documento.', { error: true });
  }
}

async function logout() {
  try {
    await closeViewer();
    await signOutCurrentSession();
  } catch (error) {
    toast(error?.message || 'Não foi possível sair.', { error: true });
    return;
  }
  clearAuthContext();
  state.context = null;
  state.documents = [];
  document.getElementById('skyrail-admin-backdrop')?.remove();
  renderLogin();
}

async function bootstrapAuthenticated() {
  try {
    const context = await resolveAuthContext({ allowOffline: true });
    if (!context) {
      renderLogin();
      return;
    }
    state.context = context;
    state.query = '';
    state.discipline = 'ALL';
    renderShell();
    await reloadLocalDocuments();
    if (navigator.onLine) await syncNow({ silent: true });
  } catch (error) {
    renderLogin(error?.message || 'Não foi possível validar o acesso ao BYD Skyrail.');
  }
}

window.addEventListener('online', () => {
  updateConnectivity();
  toast('Conexão restabelecida. Você pode sincronizar a biblioteca.');
});
window.addEventListener('offline', () => {
  updateConnectivity();
  toast('Modo offline. Os documentos já sincronizados continuam disponíveis.');
});

bootstrapAuthenticated();
