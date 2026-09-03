import './settings-refinement-ui.js';
import { getAuthClient } from './auth.js';
import { getAuthContext } from './auth-context.js';
import { CAPABILITY, ROLE, can } from './permissions.js';

let observer = null;
let busy = false;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function invokeAdmin(body) {
  const context = getAuthContext();
  if (!context?.workspaceId || !can(context.role, CAPABILITY.MANAGE_USERS)) {
    throw new Error('Sua conta não pode gerenciar usuários.');
  }
  if (!navigator.onLine) throw new Error('A gestão de usuários requer conexão com a internet.');

  const client = getAuthClient();
  const { data, error } = await client.functions.invoke('docinspector-user-admin', {
    body: { ...body, workspaceId: context.workspaceId }
  });
  if (error) {
    const message = data?.error || error?.context?.error || error.message;
    throw new Error(message || 'Falha na operação administrativa.');
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

function cardHtml(context) {
  return `
    <section class="card settings-user-admin" id="settings-user-admin" aria-labelledby="settings-user-admin-title">
      <div class="section-title">
        <div><span class="section-kicker">ACESSO</span><h2 id="settings-user-admin-title">Usuários</h2></div>
        <span class="subtitle">${esc(context.workspaceName || 'DocInspector')}</span>
      </div>
      <p class="subtitle">Convide e gerencie usuários deste workspace. Todos os acessos usam o perfil Administrador.</p>
      <form id="user-admin-invite" class="user-admin-invite">
        <div class="field"><label for="user-admin-name">Nome</label><input id="user-admin-name" maxlength="120" autocomplete="name" placeholder="Nome do usuário"></div>
        <div class="field"><label for="user-admin-email">E-mail</label><input id="user-admin-email" type="email" maxlength="254" autocomplete="email" required placeholder="usuario@empresa.com"></div>
        <button class="btn btn-primary" id="user-admin-invite-button" type="submit">Enviar convite</button>
      </form>
      <div id="user-admin-message" class="user-admin-message" hidden></div>
      <div id="user-admin-members" class="user-admin-members" aria-live="polite"><div class="subtitle">Carregando usuários…</div></div>
    </section>`;
}

function memberHtml(member) {
  const state = member.active ? 'Ativo' : 'Inativo';
  const access = member.confirmedAt ? 'Conta confirmada' : member.invitedAt ? 'Convite enviado' : 'Conta criada';
  return `
    <article class="user-admin-member ${member.active ? '' : 'inactive'}" data-user-id="${esc(member.userId)}" data-member-active-original="${member.active ? 'true' : 'false'}" data-member-self="${member.self ? 'true' : 'false'}">
      <div class="user-admin-member-copy">
        <strong>${esc(member.displayName || member.email || 'Usuário')}</strong>
        <span>${esc(member.email || 'E-mail indisponível')}</span>
        <small>${esc(access)} · ${esc(state)}${member.self ? ' · Você' : ''}</small>
      </div>
      <div class="user-admin-member-controls">
        <span class="admin-role-badge">Administrador</span>
        <label class="user-admin-active"><input data-member-active type="checkbox" ${member.active ? 'checked' : ''}><span>Ativo</span></label>
        <button class="btn" data-save-member type="button">Salvar</button>
      </div>
    </article>`;
}

function setMessage(text = '', type = '') {
  const node = document.querySelector('#user-admin-message');
  if (!node) return;
  node.hidden = !text;
  node.className = `user-admin-message ${type}`.trim();
  node.textContent = text;
}

async function loadMembers() {
  const target = document.querySelector('#user-admin-members');
  if (!target) return;
  target.innerHTML = '<div class="subtitle">Carregando usuários…</div>';
  try {
    const data = await invokeAdmin({ action: 'list' });
    const members = Array.isArray(data.members) ? data.members : [];
    target.innerHTML = members.length
      ? members.map(memberHtml).join('')
      : '<div class="card empty"><div><strong>Nenhum usuário neste workspace.</strong></div></div>';
  } catch (error) {
    target.innerHTML = `<div class="alert">${esc(error.message || 'Não foi possível carregar os usuários.')}</div>`;
  }
}

async function saveMemberChange({ row }) {
  const context = getAuthContext();
  const userId = row.dataset.userId;
  const activeControl = row.querySelector('[data-member-active]');
  const active = Boolean(activeControl?.checked);
  const wasActive = row.dataset.memberActiveOriginal === 'true';

  if (wasActive && !active) {
    if (row.dataset.memberSelf === 'true' || String(userId) === String(context?.userId)) {
      if (activeControl) activeControl.checked = true;
      throw new Error('Use outro Administrador para desativar sua própria conta do workspace.');
    }
    if (!window.confirm('Desativar este usuário no workspace? Ele perderá o acesso ao DocInspector.')) {
      if (activeControl) activeControl.checked = true;
      return { changed: false, deactivated: false };
    }
  }

  await invokeAdmin({ action: 'update', userId, role: ROLE.ADMIN, active });
  return { changed: true, deactivated: wasActive && !active };
}

function bindCard() {
  const card = document.querySelector('#settings-user-admin');
  if (!card || card.dataset.bound === '1') return;
  card.dataset.bound = '1';

  card.querySelector('#user-admin-invite')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const button = card.querySelector('#user-admin-invite-button');
    const email = card.querySelector('#user-admin-email')?.value || '';
    const displayName = card.querySelector('#user-admin-name')?.value || '';
    try {
      busy = true;
      if (button) { button.disabled = true; button.textContent = 'Enviando…'; }
      setMessage('');
      const result = await invokeAdmin({ action: 'invite', email, displayName, role: ROLE.ADMIN });
      event.currentTarget.reset();
      setMessage(result.invited ? 'Convite enviado e acesso de Administrador configurado.' : 'Usuário existente vinculado como Administrador.', 'success');
      await loadMembers();
    } catch (error) {
      setMessage(error.message || 'Não foi possível enviar o convite.', 'error');
    } finally {
      busy = false;
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Enviar convite'; }
    }
  });

  card.addEventListener('click', async event => {
    const button = event.target.closest('[data-save-member]');
    if (!button || busy) return;
    const row = button.closest('[data-user-id]');
    if (!row) return;
    try {
      busy = true;
      button.disabled = true;
      button.textContent = 'Salvando…';
      setMessage('');
      const result = await saveMemberChange({ row });
      if (!result.changed) return;
      setMessage(result.deactivated ? 'Usuário desativado.' : 'Acesso atualizado.', 'success');
      await loadMembers();
    } catch (error) {
      setMessage(error.message || 'Não foi possível atualizar este usuário.', 'error');
      await loadMembers();
    } finally {
      busy = false;
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Salvar'; }
    }
  });
}

function mount() {
  const context = getAuthContext();
  const existing = document.querySelector('#settings-user-admin');
  if (!context || !can(context.role, CAPABILITY.MANAGE_USERS)) {
    existing?.remove();
    return;
  }

  const grid = document.querySelector('.settings-grid');
  if (!grid) return;
  if (!existing) grid.insertAdjacentHTML('beforeend', cardHtml(context));
  bindCard();
  const card = document.querySelector('#settings-user-admin');
  if (card && card.dataset.loaded !== '1') {
    card.dataset.loaded = '1';
    loadMembers();
  }
}

function start() {
  mount();
  window.addEventListener('docinspector:user-admin-refresh', () => loadMembers());
  observer = new MutationObserver(() => mount());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();

export { invokeAdmin, mount };
