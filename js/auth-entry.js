import { AUTH_CONFIG, authRolloutEnabled } from './auth-config.js';
import { getStoredSession, signInWithEmailPassword, signOutCurrentSession } from './auth.js';
import { clearAuthContext, resolveAuthContext } from './auth-context.js';

const app = document.querySelector('#app');

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderAuthShell({ message = '', busy = false } = {}) {
  app.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card" aria-labelledby="auth-title">
        <div class="auth-brand">
          <img src="assets/icon.svg" alt="" aria-hidden="true">
          <div><strong><span>Doc</span>Inspector</strong><small>Acesso seguro</small></div>
        </div>
        <div class="auth-copy">
          <span class="auth-kicker">AUTENTICAÇÃO</span>
          <h1 id="auth-title">Entrar no DocInspector</h1>
          <p>Use a conta autorizada para acessar o seu workspace.</p>
        </div>
        <form id="auth-form" novalidate>
          <label>E-mail<input id="auth-email" type="email" autocomplete="username" maxlength="254" required></label>
          <label>Senha<input id="auth-password" type="password" autocomplete="current-password" maxlength="4096" required></label>
          <div id="auth-message" class="auth-message ${message ? 'error' : ''}" ${message ? '' : 'hidden'}>${esc(message)}</div>
          <button id="auth-submit" class="auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <div class="auth-note">A primeira validação neste aparelho requer conexão com a internet. Depois disso, o trabalho local pode continuar offline conforme o perfil já validado.</div>
      </section>
    </main>`;
}

function renderStarting(message = 'Validando sessão…') {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card auth-starting"><div class="auth-brand"><img src="assets/icon.svg" alt=""><div><strong><span>Doc</span>Inspector</strong><small>${esc(message)}</small></div></div><div class="auth-spinner" aria-hidden="true"></div></section></main>`;
}

async function loadApplication() {
  await import('./app.js');
  await Promise.all([
    import('./field-recovery-ui.js'),
    import('./evidence-health-ui.js'),
    import('./marking-policy-ui.js'),
    import('./copy-evidence-edit-ui.js'),
    import('./ui-refinement.js'),
    import('./export-pdf-options-ui.js'),
    import('./permission-ui.js')
  ]);
}

async function enterAuthenticatedApp() {
  renderStarting(navigator.onLine ? 'Validando acesso…' : 'Abrindo modo offline…');
  const context = await resolveAuthContext({ allowOffline: true });
  if (!context) return false;
  document.documentElement.dataset.authRole = context.role;
  document.documentElement.dataset.authenticated = 'true';
  await loadApplication();
  return true;
}

function bindLogin() {
  const form = document.querySelector('#auth-form');
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const email = document.querySelector('#auth-email')?.value || '';
    const password = document.querySelector('#auth-password')?.value || '';
    renderAuthShell({ busy: true });
    const emailInput = document.querySelector('#auth-email');
    if (emailInput) emailInput.value = email;
    try {
      if (!navigator.onLine) throw new Error('Conecte-se à internet para entrar pela primeira vez neste aparelho.');
      await signInWithEmailPassword(email, password);
      const entered = await enterAuthenticatedApp();
      if (!entered) throw new Error('A sessão não pôde ser validada.');
    } catch (error) {
      await signOutCurrentSession().catch(() => {});
      clearAuthContext();
      renderAuthShell({ message: error?.message || 'Não foi possível entrar.' });
      bindLogin();
      requestAnimationFrame(() => document.querySelector('#auth-email')?.focus());
    }
  });
}

async function bootAuthEntry() {
  if (!authRolloutEnabled()) {
    await loadApplication();
    return;
  }

  renderStarting();
  const session = await getStoredSession().catch(() => null);
  if (session?.user) {
    try {
      if (await enterAuthenticatedApp()) return;
    } catch (error) {
      if (!navigator.onLine) {
        renderAuthShell({ message: error?.message || 'Não foi possível abrir o modo offline.' });
        bindLogin();
        return;
      }
      await signOutCurrentSession().catch(() => {});
      clearAuthContext();
    }
  }

  renderAuthShell();
  bindLogin();
  requestAnimationFrame(() => document.querySelector('#auth-email')?.focus());
}

bootAuthEntry().catch(error => {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><h1>Falha ao iniciar</h1><p>${esc(error?.message || 'Erro inesperado de autenticação.')}</p><button class="auth-submit" type="button" onclick="location.reload()">Tentar novamente</button></section></main>`;
});

export { AUTH_CONFIG };
