import { getAuthContext } from './auth-context.js';
import { CAPABILITY, ROLE, ROLE_LABEL, can } from './permissions.js';
import { invokeAdmin } from './user-admin-ui.js';

let observer = null;
let busyRequestId = '';

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function roleOptions(selected = ROLE.INSPECTOR) {
  return Object.values(ROLE).map(role =>
    `<option value="${role}" ${role === selected ? 'selected' : ''}>${esc(ROLE_LABEL[role])}</option>`
  ).join('');
}

function formatRequestedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return date.toLocaleString('pt-BR');
}

function panelHtml() {
  return `
    <section class="user-admin-access-panel" id="user-admin-access-panel" aria-labelledby="user-admin-access-title">
      <div class="user-admin-access-head">
        <div>
          <span class="section-kicker">SOLICITAÇÕES</span>
          <h3 id="user-admin-access-title">Pedidos de cadastro</h3>
        </div>
        <button class="btn" id="user-admin-access-refresh" type="button">Atualizar</button>
      </div>
      <p class="subtitle">Compartilhe o código abaixo com quem precisa pedir acesso. A solicitação não cria conta nem permissão até sua aprovação.</p>
      <div id="user-admin-request-code" class="user-admin-request-code"><span>Carregando código…</span></div>
      <div id="user-admin-access-message" class="user-admin-message" hidden></div>
      <div id="user-admin-access-requests" class="user-admin-access-requests" aria-live="polite"><div class="subtitle">Carregando solicitações…</div></div>
    </section>`;
}

function requestHtml(request) {
  return `
    <article class="user-admin-access-request" data-access-request-id="${esc(request.id)}">
      <div class="user-admin-access-request-copy">
        <strong>${esc(request.displayName || request.email)}</strong>
        <span>${esc(request.email)}</span>
        <small>${esc(formatRequestedAt(request.createdAt))}</small>
        ${request.message ? `<p>${esc(request.message)}</p>` : ''}
      </div>
      <div class="user-admin-access-request-actions">
        <label>Perfil
          <select data-request-role>${roleOptions(ROLE.INSPECTOR)}</select>
        </label>
        <button class="btn btn-primary" data-request-approve type="button">Aprovar e convidar</button>
        <button class="btn" data-request-reject type="button">Rejeitar</button>
      </div>
    </article>`;
}

function setMessage(text = '', type = '') {
  const node = document.querySelector('#user-admin-access-message');
  if (!node) return;
  node.hidden = !text;
  node.className = `user-admin-message ${type}`.trim();
  node.textContent = text;
}

async function loadRequestCode() {
  const target = document.querySelector('#user-admin-request-code');
  if (!target) return;
  try {
    const data = await invokeAdmin({ action: 'access-request-code' });
    const code = String(data.requestCode || '');
    target.innerHTML = code
      ? `<div><small>Código do workspace</small><strong>${esc(code)}</strong></div><button class="btn" type="button" data-copy-request-code="${esc(code)}">Copiar código</button>`
      : '<span>Código indisponível.</span>';
  } catch (error) {
    target.innerHTML = `<span class="alert">${esc(error.message || 'Não foi possível carregar o código.')}</span>`;
  }
}

async function loadAccessRequests() {
  const target = document.querySelector('#user-admin-access-requests');
  if (!target) return;
  target.innerHTML = '<div class="subtitle">Carregando solicitações…</div>';
  try {
    const data = await invokeAdmin({ action: 'access-requests' });
    const requests = Array.isArray(data.requests) ? data.requests : [];
    target.innerHTML = requests.length
      ? requests.map(requestHtml).join('')
      : '<div class="user-admin-access-empty"><strong>Nenhuma solicitação pendente.</strong><span>Novos pedidos aparecerão aqui para aprovação.</span></div>';
  } catch (error) {
    target.innerHTML = `<div class="alert">${esc(error.message || 'Não foi possível carregar as solicitações.')}</div>`;
  }
}

async function reloadPanel() {
  setMessage('');
  await Promise.all([loadRequestCode(), loadAccessRequests()]);
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    setMessage('Código copiado.', 'success');
  } catch {
    setMessage(`Código do workspace: ${code}`, 'success');
  }
}

async function resolveRequest(row, decision) {
  const requestId = row?.dataset.accessRequestId || '';
  if (!requestId || busyRequestId) return;
  const role = row.querySelector('[data-request-role]')?.value || ROLE.INSPECTOR;
  const buttons = [...row.querySelectorAll('button')];
  try {
    busyRequestId = requestId;
    buttons.forEach(button => { button.disabled = true; });
    setMessage('');
    const result = await invokeAdmin({ action: 'resolve-access-request', requestId, decision, role });
    if (decision === 'APPROVE') {
      setMessage(result.invited ? 'Solicitação aprovada e convite enviado.' : 'Solicitação aprovada e usuário vinculado.', 'success');
      window.dispatchEvent(new CustomEvent('docinspector:user-admin-refresh'));
    } else {
      setMessage('Solicitação rejeitada.', 'success');
    }
    await loadAccessRequests();
  } catch (error) {
    setMessage(error.message || 'Não foi possível processar a solicitação.', 'error');
  } finally {
    busyRequestId = '';
    buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
  }
}

function bindPanel() {
  const panel = document.querySelector('#user-admin-access-panel');
  if (!panel || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  panel.addEventListener('click', event => {
    const copy = event.target.closest('[data-copy-request-code]');
    if (copy) {
      copyCode(copy.dataset.copyRequestCode || '');
      return;
    }

    const row = event.target.closest('[data-access-request-id]');
    if (!row) return;
    if (event.target.closest('[data-request-approve]')) {
      resolveRequest(row, 'APPROVE');
    } else if (event.target.closest('[data-request-reject]')) {
      resolveRequest(row, 'REJECT');
    }
  });

  panel.querySelector('#user-admin-access-refresh')?.addEventListener('click', () => reloadPanel());
}

function mount() {
  const context = getAuthContext();
  const adminCard = document.querySelector('#settings-user-admin');
  const existing = document.querySelector('#user-admin-access-panel');
  if (!context || !can(context.role, CAPABILITY.MANAGE_USERS) || !adminCard) {
    existing?.remove();
    return;
  }

  if (!existing) adminCard.insertAdjacentHTML('beforeend', panelHtml());
  bindPanel();
  const panel = document.querySelector('#user-admin-access-panel');
  if (panel && panel.dataset.loaded !== '1') {
    panel.dataset.loaded = '1';
    reloadPanel();
  }
}

function start() {
  mount();
  observer = new MutationObserver(() => mount());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();

export { loadAccessRequests, mount };
