import { AUTH_CONFIG } from './auth-config.js';
import { getAuthClient, getAuthenticatedUser, getStoredSession } from './auth.js';
import { normalizeRole } from './permissions.js';

const CONTEXT_KEY = 'docinspector-auth-context-v1';
const WORKSPACE_KEY = 'docinspector-auth-workspace-v1';
const LEGACY_SYNC_KEY = 'sky17-sync-config-v1';
let currentContext = null;

function normalizeText(value) {
  return String(value ?? '').trim();
}

function readCachedContext() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTEXT_KEY) || 'null');
    const role = normalizeRole(parsed?.role);
    if (!parsed?.userId || !parsed?.workspaceId || !role) return null;
    return { ...parsed, role };
  } catch {
    return null;
  }
}

function readLegacyWorkspaceId() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_SYNC_KEY) || 'null');
    return normalizeText(parsed?.workspaceId);
  } catch {
    return '';
  }
}

function cacheContext(context) {
  currentContext = context ? { ...context } : null;
  if (currentContext) localStorage.setItem(CONTEXT_KEY, JSON.stringify(currentContext));
  else localStorage.removeItem(CONTEXT_KEY);
}

export function getAuthContext() {
  return currentContext ? { ...currentContext } : null;
}

export function clearAuthContext() {
  currentContext = null;
  localStorage.removeItem(CONTEXT_KEY);
  localStorage.removeItem(WORKSPACE_KEY);
}

export function selectWorkspace(workspaceId) {
  const normalized = normalizeText(workspaceId);
  if (normalized) localStorage.setItem(WORKSPACE_KEY, normalized);
  else localStorage.removeItem(WORKSPACE_KEY);
}

async function loadOnlineContext(user) {
  const client = getAuthClient();
  const [{ data: memberships, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
    client.rpc('docinspector_my_workspaces'),
    client.from('docinspector_profiles').select('user_id,display_name').eq('user_id', user.id).maybeSingle()
  ]);

  if (membershipError) throw new Error('Não foi possível carregar os espaços autorizados para esta conta.');
  if (profileError) throw new Error('Não foi possível carregar o perfil desta conta.');

  const available = (memberships || [])
    .map(item => ({
      workspaceId: normalizeText(item.workspace_id),
      workspaceName: normalizeText(item.workspace_name) || 'DocInspector',
      role: normalizeRole(item.role),
      active: item.member_active !== false
    }))
    .filter(item => item.workspaceId && item.role && item.active);

  if (!available.length) {
    throw new Error('Sua conta ainda não possui acesso ativo a nenhum espaço do DocInspector.');
  }

  const preferred = normalizeText(localStorage.getItem(WORKSPACE_KEY)) || readLegacyWorkspaceId();
  const selected = available.find(item => item.workspaceId === preferred) || available[0];
  selectWorkspace(selected.workspaceId);

  const context = {
    userId: user.id,
    email: normalizeText(user.email).toLowerCase(),
    displayName: normalizeText(profile?.display_name) || normalizeText(user.email).split('@')[0] || 'Usuário',
    workspaceId: selected.workspaceId,
    workspaceName: selected.workspaceName,
    role: selected.role,
    workspaces: available,
    verifiedAt: new Date().toISOString(),
    offline: false,
    projectUrl: AUTH_CONFIG.projectUrl
  };
  cacheContext(context);
  return getAuthContext();
}

function loadOfflineContext(session) {
  const cached = readCachedContext();
  if (!session?.user?.id || !cached || cached.userId !== session.user.id) {
    throw new Error('Para usar o DocInspector offline, esta conta precisa ter sido validada online neste aparelho anteriormente.');
  }
  const context = {
    ...cached,
    offline: true
  };
  currentContext = context;
  return getAuthContext();
}

export async function resolveAuthContext({ allowOffline = true } = {}) {
  const session = await getStoredSession();
  if (!session?.user) return null;

  if (navigator.onLine) {
    const user = await getAuthenticatedUser();
    if (!user) return null;
    return loadOnlineContext(user);
  }

  if (!allowOffline) throw new Error('Conecte-se à internet para validar esta conta.');
  return loadOfflineContext(session);
}

export async function refreshAuthContext() {
  if (!navigator.onLine) return resolveAuthContext({ allowOffline: true });
  const user = await getAuthenticatedUser();
  if (!user) return null;
  return loadOnlineContext(user);
}
