import { authRolloutEnabled } from './auth-config.js';
import { clearAuthContext, getAuthContext } from './auth-context.js';
import { signOutCurrentSession } from './auth.js';
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
      '#restore-backup',
      'label[for="restore-backup"]'
    ],
    verifyDocuments: [
      '[data-nav="inspect"]',
      '#new-verification',
      '#scan-document',
      '#find-pw',
      '#save-verification',
      '#save-not-found',
      '#confirm-scan',
      '#add-copy',
      '[data-edit-copy-evidence]',
      '[data-remove-copy]'
    ],
    exportData: [
      '[data-export-inspection]',
      '#export-selected-inspection',
      '#generate-pdf',
      '#generate-xlsx',
      '#generate-word',
      '#create-backup'
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

  function ensureAccountBlock() {
    const footer = document.querySelector('.sidebar-footer');
    if (!footer || footer.querySelector('.auth-account-card')) return;
    const card = document.createElement('div');
    card.className = 'auth-account-card';
    card.innerHTML = `
      <div class="auth-account-copy">
        <span>${context?.displayName || 'Usuário'}</span>
        <strong>${roleLabel(role)}</strong>
        <small>${context?.workspaceName || 'Workspace'}${context?.offline ? ' · offline' : ''}</small>
      </div>
      <button id="auth-signout" type="button" aria-label="Sair desta conta" title="Sair">Sair</button>`;
    footer.prepend(card);
    card.querySelector('#auth-signout')?.addEventListener('click', async () => {
      const button = card.querySelector('#auth-signout');
      if (button) button.disabled = true;
      await signOutCurrentSession().catch(() => {});
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
