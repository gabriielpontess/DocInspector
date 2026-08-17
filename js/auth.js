import { AUTH_CONFIG, authRolloutEnabled } from './auth-config.js';

let authClient = null;

function normalize(value) {
  return String(value ?? '').trim();
}

function requireSupabaseLibrary() {
  if (!globalThis.supabase?.createClient) {
    throw new Error('A biblioteca de autenticação não está disponível. Conecte-se à internet e recarregue o DocInspector uma vez.');
  }
}

export function isAuthEnabled() {
  return authRolloutEnabled();
}

export function getAuthClient() {
  requireSupabaseLibrary();
  if (!authClient) {
    authClient = globalThis.supabase.createClient(
      AUTH_CONFIG.projectUrl,
      AUTH_CONFIG.publishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: AUTH_CONFIG.storageKey
        }
      }
    );
  }
  return authClient;
}

export async function signInWithEmailPassword(email, password) {
  const normalizedEmail = normalize(email).toLowerCase();
  const rawPassword = String(password ?? '');

  if (!normalizedEmail || !normalizedEmail.includes('@') || normalizedEmail.length > 254) {
    throw new Error('Informe um e-mail válido.');
  }
  if (!rawPassword || rawPassword.length > 4096) {
    throw new Error('Informe a senha.');
  }

  const client = getAuthClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password: rawPassword
  });
  if (error || !data?.user || !data?.session) {
    throw new Error('Não foi possível entrar. Confira o e-mail e a senha.');
  }
  return { user: data.user, session: data.session };
}

export async function requestPasswordReset(email, redirectTo = location.origin + location.pathname) {
  const normalizedEmail = normalize(email).toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@') || normalizedEmail.length > 254) {
    throw new Error('Informe um e-mail válido para recuperar a senha.');
  }
  const client = getAuthClient();
  const { error } = await client.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
  if (error) throw new Error('Não foi possível enviar o e-mail de recuperação agora.');
  return true;
}

export async function updateCurrentPassword(newPassword) {
  const password = String(newPassword ?? '');
  if (password.length < 12) throw new Error('A nova senha deve ter pelo menos 12 caracteres.');
  if (password.length > 4096) throw new Error('A nova senha é muito longa.');
  const client = getAuthClient();
  const { data, error } = await client.auth.updateUser({ password });
  if (error || !data?.user) throw new Error('Não foi possível alterar a senha desta conta.');
  return data.user;
}

export async function getAuthenticatedUser() {
  const client = getAuthClient();
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data?.user || null;
}

export async function getStoredSession() {
  const client = getAuthClient();
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data?.session || null;
}

export function onAuthStateChange(listener) {
  if (typeof listener !== 'function') throw new Error('Listener de autenticação inválido.');
  const client = getAuthClient();
  const { data } = client.auth.onAuthStateChange((event, session) => listener({ event, session }));
  return () => data?.subscription?.unsubscribe();
}

export async function signOutCurrentSession() {
  const client = getAuthClient();
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw new Error('Não foi possível encerrar esta sessão.');
}

export function resetAuthClientForTests() {
  authClient = null;
}
