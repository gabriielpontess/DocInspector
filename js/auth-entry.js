import { AUTH_CONFIG, authRolloutEnabled } from './auth-config.js';
import {
  getStoredSession,
  onAuthStateChange,
  requestPasswordReset,
  signInWithEmailPassword,
  signOutCurrentSession,
  updateCurrentPassword,
  verifyRecoveryTokenHash
} from './auth.js';
import { clearAuthContext, resolveAuthContext } from './auth-context.js';
import { submitAccessRequest } from './access-request.js';

const app = document.querySelector('#app');
const RECOVERY_REQUEST_KEY = 'docinspector-recovery-requested-v1';
let accessRequestOpenedAt = 0;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isLocalE2EBypass() {
  const localHost = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  return localHost && new URLSearchParams(location.search).get('e2e-auth-bypass') === '1';
}

function authCallbackParams() {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const read = key => query.get(key) || hash.get(key) || '';
  return {
    type: read('type'),
    code: read('code'),
    error: read('error'),
    errorCode: read('error_code'),
    errorDescription: read('error_description'),
    recoveryToken: read('recovery_token')
  };
}

function isPasswordRecoveryUrl() {
  const params = authCallbackParams();
  return params.type === 'recovery' || Boolean(params.code);
}

function authCallbackErrorMessage() {
  const params = authCallbackParams();
  const code = String(params.errorCode || params.error || '').toLowerCase();
  if (!code) return '';
  if (code.includes('otp_expired') || code.includes('expired') || code.includes('access_denied')) {
    return 'O link de recuperação já foi usado ou expirou antes da validação. Isso também pode acontecer quando o provedor de e-mail verifica links automaticamente. Não reutilize este link.';
  }
  return `O Supabase recusou o link de recuperação${params.errorCode ? ` (${params.errorCode})` : ''}. Solicite um novo link somente quando o fluxo de recuperação estiver disponível novamente.`;
}

function clearAuthCallbackUrl() {
  if (!location.search && !location.hash) return;
  history.replaceState({}, '', location.pathname);
}

function markRecoveryRequested() {
  localStorage.setItem(RECOVERY_REQUEST_KEY, new Date().toISOString());
}

function clearRecoveryRequested() {
  localStorage.removeItem(RECOVERY_REQUEST_KEY);
}

function renderAuthShell({ message = '', messageType = 'error', busy = false, email = '' } = {}) {
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
          <label>E-mail<input id="auth-email" type="email" autocomplete="username" maxlength="254" value="${esc(email)}" required></label>
          <label>Senha<input id="auth-password" type="password" autocomplete="current-password" maxlength="4096" required></label>
          <div id="auth-message" class="auth-message ${message ? messageType : ''}" ${message ? '' : 'hidden'}>${esc(message)}</div>
          <button id="auth-submit" class="auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Entrando…' : 'Entrar'}</button>
          <div class="auth-secondary-actions">
            <button id="auth-forgot" class="auth-recovery-link" type="button" ${busy ? 'disabled' : ''}>Esqueci minha senha</button>
            <span aria-hidden="true">•</span>
            <button id="auth-request-access" class="auth-recovery-link" type="button" ${busy ? 'disabled' : ''}>Solicitar cadastro</button>
          </div>
        </form>
        <div class="auth-note">A primeira validação neste aparelho requer conexão com a internet. Depois disso, o trabalho local pode continuar offline conforme o perfil já validado.</div>
      </section>
    </main>`;
}

function renderAccessRequest({ message = '', messageType = 'error', busy = false, email = '', displayName = '', requestCode = '', note = '' } = {}) {
  if (!busy) accessRequestOpenedAt = Date.now();
  app.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card auth-access-request-card" aria-labelledby="access-request-title">
        <div class="auth-brand">
          <img src="assets/icon.svg" alt="" aria-hidden="true">
          <div><strong><span>Doc</span>Inspector</strong><small>Solicitação de acesso</small></div>
        </div>
        <div class="auth-copy">
          <span class="auth-kicker">NOVO ACESSO</span>
          <h1 id="access-request-title">Solicitar cadastro</h1>
          <p>Envie uma solicitação ao administrador do workspace. Nenhuma conta ou permissão é criada automaticamente.</p>
        </div>
        <form id="access-request-form" novalidate>
          <label>Nome<input id="access-request-name" type="text" autocomplete="name" minlength="2" maxlength="120" value="${esc(displayName)}" required></label>
          <label>E-mail<input id="access-request-email" type="email" autocomplete="email" maxlength="254" value="${esc(email)}" required></label>
          <label>Código do workspace<input id="access-request-code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="14" value="${esc(requestCode)}" placeholder="Ex.: A1B2C3D4E5F6" required></label>
          <label>Observação <span class="auth-optional">opcional</span><textarea id="access-request-message" maxlength="500" rows="3" placeholder="Informe equipe, função ou contexto do acesso.">${esc(note)}</textarea></label>
          <label class="auth-honeypot" aria-hidden="true">Website<input id="access-request-website" type="text" tabindex="-1" autocomplete="off"></label>
          <div class="auth-message ${message ? messageType : ''}" ${message ? '' : 'hidden'}>${esc(message)}</div>
          <button id="access-request-submit" class="auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Enviando…' : 'Enviar solicitação'}</button>
          <button id="access-request-back" class="auth-back-link" type="button" ${busy ? 'disabled' : ''}>Voltar para entrar</button>
        </form>
        <div class="auth-note">O código do workspace é fornecido pelo Administrador. Após a aprovação, você receberá o convite de acesso no e-mail informado.</div>
      </section>
    </main>`;
}

function renderRecoveryLanding({ message = '', busy = false } = {}) {
  app.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card" aria-labelledby="recovery-continue-title">
        <div class="auth-brand">
          <img src="assets/icon.svg" alt="" aria-hidden="true">
          <div><strong><span>Doc</span>Inspector</strong><small>Recuperação segura</small></div>
        </div>
        <div class="auth-copy">
          <span class="auth-kicker">RECUPERAÇÃO</span>
          <h1 id="recovery-continue-title">Continuar redefinição</h1>
          <p>O código só será validado depois que você confirmar esta ação.</p>
        </div>
        <div class="auth-message error" ${message ? '' : 'hidden'}>${esc(message)}</div>
        <button id="auth-recovery-continue" class="auth-submit" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Validando…' : 'Continuar redefinição'}</button>
        <div class="auth-note">Esta etapa evita que verificações automáticas do provedor de e-mail consumam o código antes de você utilizá-lo.</div>
      </section>
    </main>`;
}

function renderPasswordRecovery({ message = '', busy = false } = {}) {
  app.innerHTML = `
    <main class="auth-screen">
      <section class="auth-card" aria-labelledby="recovery-title">
        <div class="auth-brand">
          <img src="assets/icon.svg" alt="" aria-hidden="true">
          <div><strong><span>Doc</span>Inspector</strong><small>Recuperação segura</small></div>
        </div>
        <div class="auth-copy">
          <span class="auth-kicker">NOVA SENHA</span>
          <h1 id="recovery-title">Definir nova senha</h1>
          <p>Crie uma nova senha com pelo menos 12 caracteres.</p>
        </div>
        <form id="auth-recovery-form" novalidate>
          <label>Nova senha<input id="auth-new-password" type="password" autocomplete="new-password" minlength="12" maxlength="4096" required></label>
          <label>Confirmar nova senha<input id="auth-confirm-password" type="password" autocomplete="new-password" minlength="12" maxlength="4096" required></label>
          <div class="auth-message error" ${message ? '' : 'hidden'}>${esc(message)}</div>
          <button class="auth-submit" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Salvando…' : 'Salvar nova senha'}</button>
        </form>
      </section>
    </main>`;
}

function renderStarting(message = 'Validando sessão…') {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card auth-starting"><div class="auth-brand"><img src="assets/icon.svg" alt=""><div><strong><span>Doc</span>Inspector</strong><small>${esc(message)}</small></div></div><div class="auth-spinner" aria-hidden="true"></div></section></main>`;
}

async function loadApplication({ skipAuthUi = false } = {}) {
  await import('./app.js');
  const modules = [
    import('./field-recovery-ui.js'),
    import('./evidence-health-ui.js'),
    import('./marking-policy-ui.js'),
    import('./copy-evidence-edit-ui.js'),
    import('./document-management-ui.js'),
    import('./ui-refinement.js'),
    import('./export-pdf-options-ui.js')
  ];
  if (!skipAuthUi) {
    modules.push(import('./permission-ui.js'), import('./user-admin-ui.js'), import('./access-request-admin-ui.js'));
  }
  await Promise.all(modules);
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

async function waitForRecoverySession() {
  const existing = await getStoredSession().catch(() => null);
  if (existing?.user) return existing;
  return new Promise(resolve => {
    let settled = false;
    const finish = session => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve(session || null);
    };
    const unsubscribe = onAuthStateChange(({ event, session }) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session?.user) finish(session);
    });
    window.setTimeout(() => finish(null), 5000);
  });
}

function bindAccessRequest() {
  document.querySelector('#access-request-back')?.addEventListener('click', () => {
    const email = document.querySelector('#access-request-email')?.value || '';
    renderAuthShell({ email });
    bindLogin();
    requestAnimationFrame(() => document.querySelector('#auth-email')?.focus());
  });

  document.querySelector('#access-request-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const displayName = document.querySelector('#access-request-name')?.value || '';
    const email = document.querySelector('#access-request-email')?.value || '';
    const requestCode = document.querySelector('#access-request-code')?.value || '';
    const note = document.querySelector('#access-request-message')?.value || '';
    const website = document.querySelector('#access-request-website')?.value || '';
    const elapsedMs = Math.max(0, Date.now() - accessRequestOpenedAt);

    if (displayName.trim().length < 2) {
      renderAccessRequest({ message: 'Informe seu nome.', email, displayName, requestCode, note });
      bindAccessRequest();
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      renderAccessRequest({ message: 'Informe um e-mail válido.', email, displayName, requestCode, note });
      bindAccessRequest();
      return;
    }
    if (requestCode.replace(/[^0-9a-f]/gi, '').length !== 12) {
      renderAccessRequest({ message: 'Informe o código de 12 caracteres fornecido pelo Administrador.', email, displayName, requestCode, note });
      bindAccessRequest();
      return;
    }

    renderAccessRequest({ busy: true, email, displayName, requestCode, note });
    try {
      await submitAccessRequest({ email, displayName, requestCode, message: note, website, elapsedMs });
      renderAuthShell({
        message: 'Solicitação enviada. O Administrador do workspace precisa aprovar o pedido antes de você receber o convite.',
        messageType: 'success',
        email
      });
      bindLogin();
      requestAnimationFrame(() => document.querySelector('#auth-password')?.focus());
    } catch (error) {
      renderAccessRequest({ message: error?.message || 'Não foi possível enviar a solicitação.', email, displayName, requestCode, note });
      bindAccessRequest();
    }
  });
}

function bindRecoveryLanding(tokenHash) {
  document.querySelector('#auth-recovery-continue')?.addEventListener('click', async () => {
    renderRecoveryLanding({ busy: true });
    try {
      await verifyRecoveryTokenHash(tokenHash);
      clearAuthCallbackUrl();
      renderPasswordRecovery();
      bindPasswordRecovery();
      requestAnimationFrame(() => document.querySelector('#auth-new-password')?.focus());
    } catch (error) {
      clearAuthCallbackUrl();
      renderAuthShell({ message: error?.message || 'Não foi possível validar este código de recuperação.' });
      bindLogin();
    }
  });
}

function bindPasswordRecovery() {
  document.querySelector('#auth-recovery-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.querySelector('#auth-new-password')?.value || '';
    const confirmation = document.querySelector('#auth-confirm-password')?.value || '';
    if (password !== confirmation) {
      renderPasswordRecovery({ message: 'As senhas informadas são diferentes.' });
      bindPasswordRecovery();
      return;
    }
    renderPasswordRecovery({ busy: true });
    try {
      await updateCurrentPassword(password);
      clearRecoveryRequested();
      clearAuthCallbackUrl();
      const entered = await enterAuthenticatedApp();
      if (!entered) throw new Error('A nova senha foi salva, mas a sessão não pôde ser carregada. Entre novamente.');
    } catch (error) {
      renderPasswordRecovery({ message: error?.message || 'Não foi possível salvar a nova senha.' });
      bindPasswordRecovery();
    }
  });
}

function bindLogin() {
  const form = document.querySelector('#auth-form');
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const email = document.querySelector('#auth-email')?.value || '';
    const password = document.querySelector('#auth-password')?.value || '';
    renderAuthShell({ busy: true, email });
    try {
      if (!navigator.onLine) throw new Error('Conecte-se à internet para entrar pela primeira vez neste aparelho.');
      await signInWithEmailPassword(email, password);
      clearRecoveryRequested();
      const entered = await enterAuthenticatedApp();
      if (!entered) throw new Error('A sessão não pôde ser validada.');
    } catch (error) {
      await signOutCurrentSession().catch(() => {});
      clearAuthContext();
      renderAuthShell({ message: error?.message || 'Não foi possível entrar.', email });
      bindLogin();
      requestAnimationFrame(() => document.querySelector('#auth-password')?.focus());
    }
  });

  document.querySelector('#auth-forgot')?.addEventListener('click', async () => {
    const email = document.querySelector('#auth-email')?.value || '';
    if (!navigator.onLine) {
      renderAuthShell({ message: 'Conecte-se à internet para recuperar a senha.', email });
      bindLogin();
      return;
    }
    try {
      await requestPasswordReset(email, `${location.origin}${location.pathname}`);
      markRecoveryRequested();
      renderAuthShell({
        message: 'E-mail de recuperação enviado. Abra o link recebido para definir uma nova senha.',
        messageType: 'success',
        email
      });
      bindLogin();
    } catch (error) {
      renderAuthShell({ message: error?.message || 'Não foi possível enviar a recuperação.', email });
      bindLogin();
    }
  });

  document.querySelector('#auth-request-access')?.addEventListener('click', () => {
    const email = document.querySelector('#auth-email')?.value || '';
    renderAccessRequest({ email });
    bindAccessRequest();
    requestAnimationFrame(() => document.querySelector('#access-request-name')?.focus());
  });
}

async function bootAuthEntry() {
  if (isLocalE2EBypass()) {
    document.documentElement.dataset.authTestBypass = 'true';
    await loadApplication({ skipAuthUi: true });
    return;
  }

  if (!authRolloutEnabled()) {
    await loadApplication();
    return;
  }

  const params = authCallbackParams();
  if (params.recoveryToken) {
    renderRecoveryLanding();
    bindRecoveryLanding(params.recoveryToken);
    return;
  }

  const callbackError = authCallbackErrorMessage();
  if (callbackError) {
    clearAuthCallbackUrl();
    renderAuthShell({ message: callbackError });
    bindLogin();
    return;
  }

  if (isPasswordRecoveryUrl()) {
    renderStarting('Validando recuperação…');
    const session = await waitForRecoverySession();
    if (!session?.user) {
      clearAuthCallbackUrl();
      renderAuthShell({ message: 'O link de recuperação expirou ou não pôde ser validado. Solicite um novo link apenas quando o fluxo de recuperação estiver disponível novamente.' });
      bindLogin();
      return;
    }
    renderPasswordRecovery();
    bindPasswordRecovery();
    requestAnimationFrame(() => document.querySelector('#auth-new-password')?.focus());
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
