import './confidential-e2ee-ui.js';
import { authRolloutEnabled } from './auth-config.js';
import { clearAuthContext, getAuthContext } from './auth-context.js';
import { signOutCurrentSession, updateCurrentPassword } from './auth.js';
import { clearLocalConfidentialKeys } from './confidential-keyring.js';
import { clearAllConfidentialCiphertext } from './confidential-offline.js';
import { clearCachedWorkspaceEnvelopes } from './confidential-offline-key.js';
import { CAPABILITY, can, roleLabel } from './permissions.js';

if (authRolloutEnabled()) {
  const context = getAuthContext();
  const role = context?.role;

  const SELECTORS = {
    manageInspections: [
      '#new-inspection-hero',
      '[data-edit-inspection]',
      '[data-update-inspection-list]',
      '[data-delete]',
      '#restore',
      '#restore-file'
    ],
    verifyDocuments: [
      '[data-nav="inspect"]',
      '#new-verification',
      '#scan-document',
      '#find-pw',
      '#save-verification',
      '#mark-not-found',
      '#scan-confirm',
      '[data-copy-edit]',
      '[data-copy-delete]'
    ],
    exportData: [
      '[data-export-inspection]',
      '#export-selected-inspection',
      '#generate-pdf',
      '#generate-xlsx',
      '#generate-word',
      '#backup'
    ],
    manageUsers: [],
    manageProjectFiles: []
  };

  function hideSelector(selector) {
    document.querySelectorAll(selector).forEach(element => {
      element.hidden = true;
      element.setAttribute('aria-hidden', 'true');
      if ('disabled' in element) element.disabled = true;
      if (element.closest('.inspection-more-menu') && element.matches('[data-edit-inspection],[data-update-inspection-list],[data-delete],[data-export-inspection]')) {
        const menu = element.closest('.inspection-more-menu');
        const visibleActions = [...menu.querySelectorAll('button')].some(button => !button.hidden);
        if (!visibleActions) menu.hidden = true;
      }
    });
  }

  function applyCapability(capability, selectors) {
    if (can(role, capability)) return;
    selectors.forEach(hideSelector);
  }

  function ensurePasswordDialog() {
    if (document.querySelector('#auth-password-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'auth-password-dialog';
    dialog.className = 'auth-password-dialog';
    dialog.innerHTML = `
      <form method="dialog" id="auth-password-form" class="auth-password-form">
        <div class="auth-password-head">
          <div><span class="auth-kicker">SEGURANÇA</span><h2>Alterar senha</h2></div>
          <button value="cancel" type="submit" class="auth-password-close" aria-label="Fechar">×</button>
        </div>
        <p>Use pelo menos 12 caracteres. A nova senha passa a valer imediatamente nesta conta.</p>
        <label>Nova senha<input id="auth-new-password" type="password" autocomplete="new-password" minlength="12" maxlength="4096" required></label>
        <label>Confirmar senha<input id="auth-confirm-password" type="password" autocomplete="new-password" minlength="12" maxlength="4096" required></label>
        <div id="auth-password-message" class="auth-message" hidden></div>
        <div class="auth-password-actions">
          <button value="cancel" type="submit" class="btn">Cancelar</button>
          <button id="auth-password-save" type="button" class="btn btn-primary">Salvar nova senha</button>
        </div>
      </form>`;
    document.body.append(dialog);

    dialog.querySelector('#auth-password-save')?.addEventListener('click', async () => {
      const password = dialog.querySelector('#auth-new-password')?.value || '';
      const confirmation = dialog.querySelector('#auth-confirm-password')?.value || '';
      const message = dialog.querySelector('#auth-password-message');
      const button = dialog.querySelector('#auth-password-save');
      if (message) { message.hidden = true; message.className = 'auth-message'; message.textContent = ''; }
      if (password !== confirmation) {
        if (message) { message.hidden = false; message.className = 'auth-message error'; message.textContent = 'As senhas informadas não coincidem.'; }
        return;
      }
      try {
        if (button) { button.disabled = true; button.textContent = 'Salvando…'; }
        await updateCurrentPassword(password);
        if (message) { message.hidden = false; message.className = 'auth-message success'; message.textContent = 'Senha alterada com sucesso.'; }
        dialog.querySelector('#auth-new-password').value = '';
        dialog.querySelector('#auth-confirm-password').value = '';
        window.setTimeout(() => dialog.open && dialog.close(), 700);
      } catch (error) {
        if (message) { message.hidden = false; message.className = 'auth-message error'; message.textContent = error?.message || 'Não foi possível alterar a senha.'; }
      } finally {
        if (button?.isConnected) { button.disabled = false; button.textContent = 'Salvar nova senha'; }
      }
    });
  }

  function ensureAccountBlock() {
    const footer = document.querySelector('.sidebar-footer');
    if (!footer || footer.querySelector('.auth-account-card')) return;
    ensurePasswordDialog();
    const card = document.createElement('div');
    card.className = 'auth-account-card';
    card.innerHTML = `
      <div class="auth-account-copy">
        <span>${context?.displayName || 'Usuário'}</span>
        <strong>${roleLabel(role)}</strong>
        <small>${context?.workspaceName || 'Workspace'}${context?.offline ? ' · offline' : ''}</small>
      </div>
      <div class="auth-account-actions">
        <button id="auth-change-password" type="button" title="Alterar senha">Senha</button>
        <button id="auth-signout" type="button" aria-label="Sair desta conta" title="Sair">Sair</button>
      </div>`;
    footer.prepend(card);
    card.querySelector('#auth-change-password')?.addEventListener('click', () => {
      const dialog = document.querySelector('#auth-password-dialog');
      dialog?.showModal();
      requestAnimationFrame(() => dialog?.querySelector('#auth-new-password')?.focus());
    });
    card.querySelector('#auth-signout')?.addEventListener('click', async () => {
      const button = card.querySelector('#auth-signout');
      if (button) button.disabled = true;
      await signOutCurrentSession().catch(() => {});
      await Promise.allSettled([
        clearLocalConfidentialKeys(),
        clearAllConfidentialCiphertext(),
        clearCachedWorkspaceEnvelopes()
      ]);
      clearAuthContext();
      location.reload();
    });
  }

  function enforceViewAccess() {
    if (!can(role, CAPABILITY.VERIFY_DOCUMENTS) && location.hash === '#inspect') location.hash = '';
    if (!can(role, CAPABILITY.MANAGE_INSPECTIONS)) {
      document.querySelectorAll('.inspection-item').forEach(card => card.classList.add('role-readonly-card'));
    }
    document.documentElement.classList.toggle('role-readonly', !can(role, CAPABILITY.MANAGE_INSPECTIONS));
  }

  function applyPermissions() {
    applyCapability(CAPABILITY.MANAGE_INSPECTIONS, SELECTORS.manageInspections);
    applyCapability(CAPABILITY.VERIFY_DOCUMENTS, SELECTORS.verifyDocuments);
    applyCapability(CAPABILITY.EXPORT_DATA, SELECTORS.exportData);

    if (!can(role, CAPABILITY.MANAGE_INSPECTIONS)) {
      hideSelector('[data-nav="settings"]');
      hideSelector('#sync-badge');
      hideSelector('.new-inspection-callout');
      hideSelector('.inspection-more-menu');
    }

    ensureAccountBlock();
    enforceViewAccess();
  }

  const observer = new MutationObserver(() => applyPermissions());
  observer.observe(document.body, { childList: true, subtree: true });
  applyPermissions();

  window.addEventListener('online', () => {
    const account = document.querySelector('.auth-account-card small');
    if (account && context) account.textContent = context.workspaceName || 'Workspace';
  });
}
