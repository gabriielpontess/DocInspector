import { getAuthClient } from './auth.js';
import { getAuthContext } from './auth-context.js';
import { CAPABILITY, ROLE, ROLE_LABEL, can } from './permissions.js';

let observer = null;
let busy = false;
let rotationModulePromise = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function roleOptions(selected) {
  return Object.values(ROLE).map(role =>
    `<option value="${role}" ${role === selected ? 'selected' : ''}>${esc(ROLE_LABEL[role])}</option>`
  ).join('');
}

async function loadRotationModule() {
  if (!rotationModulePromise) {
    rotationModulePromise = import('./confidential-rotation.js').catch(error => {
      rotationModulePromise = null;
      throw error;
    });
  }
  return rotationModulePromise;
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
        <div><span class="section-kicker">ACESSO E PERFIS</span><h2 id="settings-user-admin-title">Usuários</h2></div>
        <span class="subtitle">${esc(context.workspaceName || 'DocInspector')}</span>
      </div>
      <p class="subtitle">Convide usuários e defina o perfil de acesso deste workspace. Apenas Administradores podem alterar estas permissões.</p>
      <form id="user-admin-invite" class="user-admin-invite">
        <div class="field"><label for="user-admin-name">Nome</label><input id="user-admin-name" maxlength="120" autocomplete="name" placeholder="Nome do usuário"></div>
        <div class="field"><label for="user-admin-email">E-mail</label><input id="user-admin-email" type="email" maxlength="254" autocomplete="email" required placeholder="usuario@empresa.com"></div>
        <div class="field"><label for="user-admin-role">Perfil</label><select id="user-admin-role">${roleOptions(ROLE.INSPECTOR)}</select></div>
        <button class="btn btn-primary" id="user-admin-invite-button" type="submit">Enviar convite</button>
      </form>
      <div id="user-admin-message" class="user-admin-message" hidden></div>
      <div id="user-admin-rotation" class="alert" hidden>
        <span data-rotation-message></span>
        <button class="btn btn-compact" data-resume-rotation type="button" hidden>Retomar rotação E2EE</button>
      </div>
      <div id="user-admin-members" class="user-admin-members" aria-live="polite"><div class="subtitle">Carregando usuários…</div></div>
    </section>`;
}

function memberHtml(member) {
  const state = member.active ? 'Ativo' : 'Inativo';
  const access = member.confirmedAt ? 'Conta confirmada' : member.invitedAt ? 'Convite enviado' : 'Conta criada';
  return `
    <article class="user-admin-member ${member.active ? '' : 'inactive'}" data-user-id="${esc(member.userId)}" data-member-role-original="${esc(member.role)}" data-member-active-original="${member.active ? 'true' : 'false'}" data-member-self="${member.self ? 'true' : 'false'}">
      <div class="user-admin-member-copy">
        <strong>${esc(member.displayName || member.email || 'Usuário')}</strong>
        <span>${esc(member.email || 'E-mail indisponível')}</span>
        <small>${esc(access)} · ${esc(state)}${member.self ? ' · Você' : ''}</small>
      </div>
      <div class="user-admin-member-controls">
        <select data-member-role aria-label="Perfil de ${esc(member.email || member.displayName || 'usuário')}">${roleOptions(member.role)}</select>
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

function setRotationState(text = '', { resumable = false } = {}) {
  const node = document.querySelector('#user-admin-rotation');
  if (!node) return;
  const message = node.querySelector('[data-rotation-message]');
  const resume = node.querySelector('[data-resume-rotation]');
  node.hidden = !text;
  if (message) message.textContent = text;
  if (resume) resume.hidden = !resumable;
}

function rotationProgressText(progress = {}) {
  switch (progress.stage) {
    case 'starting': return 'Removendo acesso e iniciando rotação E2EE…';
    case 'granting': return `Distribuindo a nova chave do workspace${Number.isFinite(progress.total) ? ` (${progress.completed || 0}/${progress.total})` : '…'}`;
    case 'rewrapping': return `Atualizando envelopes dos PDFs${Number.isFinite(progress.total) ? ` (${progress.completed || 0}/${progress.total})` : '…'}`;
    case 'finishing': return 'Finalizando rotação E2EE…';
    case 'completed': return 'Rotação E2EE concluída.';
    default: return 'Processando rotação E2EE…';
  }
}

async function refreshRotationState() {
  const context = getAuthContext();
  if (!context?.workspaceId || context.role !== ROLE.ADMIN || !navigator.onLine) {
    setRotationState('');
    return null;
  }
  try {
    const { getWorkspaceRotationStatus } = await loadRotationModule();
    const rotation = await getWorkspaceRotationStatus({ workspaceId: context.workspaceId });
    if (rotation?.status === 'ROTATING') {
      const remaining = Number(rotation.remaining_documents ?? Math.max(0, Number(rotation.total_documents || 0) - Number(rotation.processed_documents || 0)));
      setRotationState(`Há uma rotação E2EE pendente${Number.isFinite(remaining) ? ` · ${remaining} PDF(s) aguardando rewrap` : ''}.`, { resumable: true });
      return rotation;
    }
    setRotationState('');
    return rotation;
  } catch (error) {
    setRotationState(error?.message || 'Não foi possível consultar a rotação E2EE.', { resumable: false });
    return null;
  }
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
    await refreshRotationState();
  } catch (error) {
    target.innerHTML = `<div class="alert">${esc(error.message || 'Não foi possível carregar os usuários.')}</div>`;
  }
}

async function removeMemberSecurely({ userId, row, button }) {
  const context = getAuthContext();
  if (!context?.workspaceId || context.role !== ROLE.ADMIN) throw new Error('Somente ADMIN pode remover membros com rotação E2EE.');
  if (row.dataset.memberSelf === 'true' || String(userId) === String(context.userId)) {
    throw new Error('Use outro Administrador para remover sua própria conta do workspace.');
  }
  const originalRole = row.dataset.memberRoleOriginal || '';
  const requestedRole = row.querySelector('[data-member-role]')?.value || '';
  if (requestedRole !== originalRole) {
    throw new Error('Salve a alteração de perfil separadamente antes de remover o membro.');
  }
  if (!window.confirm('Desativar este usuário e rotacionar a chave E2EE do workspace? O acesso será revogado imediatamente.')) {
    row.querySelector('[data-member-active]').checked = true;
    return false;
  }

  const { removeMemberAndRotateWorkspaceKey } = await loadRotationModule();
  button.textContent = 'Rotacionando…';
  await removeMemberAndRotateWorkspaceKey({
    workspaceId: context.workspaceId,
    removedUserId: userId,
    onProgress: progress => setRotationState(rotationProgressText(progress))
  });
  setRotationState('');
  return true;
}

async function saveMemberChange({ row, button }) {
  const userId = row.dataset.userId;
  const role = row.querySelector('[data-member-role]')?.value;
  const active = Boolean(row.querySelector('[data-member-active]')?.checked);
  const wasActive = row.dataset.memberActiveOriginal === 'true';

  if (wasActive && !active) {
    const removed = await removeMemberSecurely({ userId, row, button });
    if (!removed) return { changed: false, removed: false };
    return { changed: true, removed: true };
  }

  await invokeAdmin({ action: 'update', userId, role, active });
  return { changed: true, removed: false };
}

async function resumePendingRotation(button) {
  const context = getAuthContext();
  if (!context?.workspaceId || context.role !== ROLE.ADMIN) throw new Error('Somente ADMIN pode retomar a rotação E2EE.');
  const { resumeWorkspaceKeyRotation } = await loadRotationModule();
  button.textContent = 'Retomando…';
  await resumeWorkspaceKeyRotation({
    workspaceId: context.workspaceId,
    onProgress: progress => setRotationState(rotationProgressText(progress))
  });
  setRotationState('');
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
    const role = card.querySelector('#user-admin-role')?.value || ROLE.INSPECTOR;
    try {
      busy = true;
      if (button) { button.disabled = true; button.textContent = 'Enviando…'; }
      setMessage('');
      const result = await invokeAdmin({ action: 'invite', email, displayName, role });
      event.currentTarget.reset();
      const roleSelect = card.querySelector('#user-admin-role');
      if (roleSelect) roleSelect.value = ROLE.INSPECTOR;
      setMessage(result.invited ? 'Convite enviado e acesso configurado.' : 'Usuário existente vinculado ao workspace.', 'success');
      await loadMembers();
    } catch (error) {
      setMessage(error.message || 'Não foi possível enviar o convite.', 'error');
    } finally {
      busy = false;
      if (button?.isConnected) { button.disabled = false; button.textContent = 'Enviar convite'; }
    }
  });

  card.addEventListener('click', async event => {
    const resumeButton = event.target.closest('[data-resume-rotation]');
    if (resumeButton && !busy) {
      try {
        busy = true;
        resumeButton.disabled = true;
        setMessage('');
        await resumePendingRotation(resumeButton);
        setMessage('Rotação E2EE retomada e concluída.', 'success');
        await loadMembers();
      } catch (error) {
        setMessage(error.message || 'Não foi possível retomar a rotação E2EE.', 'error');
        await refreshRotationState();
      } finally {
        busy = false;
        if (resumeButton?.isConnected) { resumeButton.disabled = false; resumeButton.textContent = 'Retomar rotação E2EE'; }
      }
      return;
    }

    const button = event.target.closest('[data-save-member]');
    if (!button || busy) return;
    const row = button.closest('[data-user-id]');
    if (!row) return;
    try {
      busy = true;
      button.disabled = true;
      button.textContent = 'Salvando…';
      setMessage('');
      const result = await saveMemberChange({ row, button });
      if (!result.changed) return;
      setMessage(result.removed ? 'Usuário removido e Workspace Key rotacionada com segurança.' : 'Permissões atualizadas.', 'success');
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
