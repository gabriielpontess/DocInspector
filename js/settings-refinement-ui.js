let observer = null;

function cardByTitle(grid, title) {
  return [...grid.querySelectorAll(':scope > .card')].find(card =>
    card.querySelector(':scope > h2')?.textContent?.trim() === title
  ) || null;
}

function ensureStyles() {
  if (document.querySelector('#settings-refinement-styles')) return;
  const style = document.createElement('style');
  style.id = 'settings-refinement-styles';
  style.textContent = `
    .settings-backup-card { grid-column: 1 / -1; }
    .settings-backup-copy { max-width: 900px; margin: 0; }
    .settings-backup-actions { justify-content: flex-start; flex-wrap: wrap; margin-top: 16px; }
    .settings-pwa-action { min-height: 38px; padding: 8px 12px; }
    .admin-role-badge { display: inline-flex; align-items: center; min-height: 36px; padding: 7px 11px; border: 1px solid #d7dee7; border-radius: 10px; color: #405166; background: #f7f9fb; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .user-admin-invite { grid-template-columns: minmax(0,1fr) minmax(0,1.35fr) auto; }
    .user-admin-member-controls { grid-template-columns: auto auto auto; }
    .user-admin-access-request-actions { grid-template-columns: auto auto; }
    .user-admin-active { flex: 0 0 auto; white-space: nowrap; min-width: max-content; }
    .user-admin-active input[type="checkbox"] { width: 20px !important; min-width: 20px !important; height: 20px !important; min-height: 20px !important; padding: 0 !important; margin: 0 !important; flex: 0 0 20px; }
    @media (max-width: 900px) {
      .user-admin-invite { grid-template-columns: 1fr 1fr; }
      .user-admin-invite > .btn { grid-column: 1 / -1; justify-self: start; }
      .user-admin-member-controls { grid-template-columns: auto auto auto; justify-content: start; }
      .user-admin-access-request-actions { grid-template-columns: auto auto; justify-content: start; }
    }
    @media (max-width: 600px) {
      .settings-backup-actions { display: grid; grid-template-columns: 1fr; }
      .settings-backup-actions .btn { width: 100%; }
      .user-admin-invite, .user-admin-member-controls, .user-admin-access-request-actions { grid-template-columns: 1fr; }
      .user-admin-invite > .btn { grid-column: auto; width: 100%; }
      .admin-role-badge { justify-content: center; width: 100%; }
      .user-admin-active { min-height: 44px; }
    }
  `;
  document.head.append(style);
}

function compactPwaInstall(grid) {
  const card = cardByTitle(grid, 'Instalação PWA');
  if (!card) return;
  const button = card.querySelector('#install-app');
  if (button && !button.disabled) {
    button.classList.add('settings-pwa-action');
    const label = button.querySelector('span');
    if (label) label.textContent = 'Instalar PWA';
    const actions = document.querySelector('.topbar-actions');
    if (actions && !actions.querySelector('#install-app')) actions.prepend(button);
  }
  card.remove();
}

function mergeBackupCards(grid) {
  const backup = cardByTitle(grid, 'Backup');
  const restore = cardByTitle(grid, 'Restauração');
  if (!backup || !restore || grid.querySelector('.settings-backup-card')) return;

  const backupButton = backup.querySelector('#backup');
  const restoreButton = restore.querySelector('#restore');
  const restoreInput = restore.querySelector('#restore-file');
  if (!backupButton || !restoreButton || !restoreInput) return;

  const card = document.createElement('section');
  card.className = 'card settings-wide settings-backup-card';
  card.innerHTML = `
    <h2>Backup e restauração</h2>
    <p class="subtitle settings-backup-copy">A sincronização com o Supabase mantém a cópia operacional entre aparelhos. Use o backup JSON como camada adicional de recuperação e portabilidade.</p>
    <div class="actions settings-backup-actions"></div>`;
  const actions = card.querySelector('.settings-backup-actions');
  backupButton.textContent = 'Gerar backup';
  restoreButton.textContent = 'Restaurar backup';
  actions.append(backupButton, restoreButton, restoreInput);
  backup.replaceWith(card);
  restore.remove();
}

function removeObsoleteWarning(grid) {
  cardByTitle(grid, 'Importante')?.remove();
}

function refineSettings() {
  const grid = document.querySelector('.settings-grid');
  if (!grid || grid.dataset.refinedSettings === '1') return;
  ensureStyles();
  compactPwaInstall(grid);
  mergeBackupCards(grid);
  removeObsoleteWarning(grid);
  grid.dataset.refinedSettings = '1';
}

function start() {
  ensureStyles();
  refineSettings();
  observer = new MutationObserver(() => refineSettings());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.body) start();

export { refineSettings };
