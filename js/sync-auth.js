import * as legacy from './sync.js?legacy=1';
import {
  deleteInspection,
  deleteSyncMeta,
  getEvidence,
  getSyncMeta,
  listInspections,
  saveInspection,
  setSyncMeta,
  updateEvidence
} from './db.js';
import { hydrateInspection } from './domain.js';
import { AUTH_CONFIG, authRolloutEnabled } from './auth-config.js';
import { getAuthClient } from './auth.js';
import { getAuthContext, refreshAuthContext } from './auth-context.js';

export * from './sync.js?legacy=1';

const DELETIONS_KEY = 'pending-deletions';
const EVIDENCE_DELETIONS_KEY = 'pending-evidence-deletions';
const DEVICE_KEY = 'sky17-device-id';
const EVIDENCE_BUCKET = 'docinspector-evidence';
const SYNC_INTERVAL_MS = 30000;
const AUTH_WORKSPACE_BINDING_KEY = 'auth-workspace-binding-v1';
const AUTH_QUARANTINE_KEY = 'auth-workspace-quarantine-v1';

let timer = null;
let lifecycleBound = false;
let activeSyncPromise = null;
let syncRequested = false;
let announceRequested = false;
let lastStatus = { state: 'local', label: 'Somente local', lastSyncAt: null, error: null };

function authMode() {
  return authRolloutEnabled();
}

function emitStatus(next) {
  lastStatus = { ...lastStatus, ...next };
  window.dispatchEvent(new CustomEvent('sky17:sync-status', { detail: lastStatus }));
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getSyncConfig() {
  if (!authMode()) return legacy.getSyncConfig();
  const context = getAuthContext();
  if (!context?.workspaceId) return null;
  return {
    mode: 'authenticated',
    url: AUTH_CONFIG.projectUrl,
    publishableKey: AUTH_CONFIG.publishableKey,
    workspaceId: context.workspaceId,
    workspaceName: context.workspaceName,
    role: context.role
  };
}

export function getSyncStatus() {
  if (!authMode()) return legacy.getSyncStatus();
  return { ...lastStatus, configured: Boolean(getSyncConfig()) };
}

export function mergeInspection(localInspection, remoteInspection) {
  return legacy.mergeInspection(localInspection, remoteInspection);
}

function comparable(inspection) {
  const copy = structuredClone(inspection);
  copy.documents.sort((a, b) => a.code.localeCompare(b.code));
  for (const document of copy.documents) {
    if (Array.isArray(document.fieldCopies)) document.fieldCopies.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (Array.isArray(document.deletedCopyIds)) document.deletedCopyIds.sort((a, b) => String(a).localeCompare(String(b)));
  }
  return JSON.stringify(copy);
}

function inspectionTimestamp(inspection) {
  const value = Date.parse(inspection?.createdAt || inspection?.updatedAt || '');
  return Number.isFinite(value) ? value : 0;
}

async function quarantinePendingQueues(previousWorkspaceId, nextWorkspaceId) {
  const [deletions, evidenceDeletions, existing] = await Promise.all([
    getSyncMeta(DELETIONS_KEY, []).catch(() => []),
    getSyncMeta(EVIDENCE_DELETIONS_KEY, []).catch(() => []),
    getSyncMeta(AUTH_QUARANTINE_KEY, []).catch(() => [])
  ]);
  if (deletions.length || evidenceDeletions.length) {
    const record = {
      previousWorkspaceId: previousWorkspaceId || null,
      nextWorkspaceId,
      quarantinedAt: new Date().toISOString(),
      deletions,
      evidenceDeletions
    };
    await setSyncMeta(AUTH_QUARANTINE_KEY, [...existing, record].slice(-10));
  }
  await Promise.all([
    deleteSyncMeta(DELETIONS_KEY).catch(() => {}),
    deleteSyncMeta(EVIDENCE_DELETIONS_KEY).catch(() => {})
  ]);
}

async function ensureWorkspaceBinding(workspaceId) {
  const current = await getSyncMeta(AUTH_WORKSPACE_BINDING_KEY, null).catch(() => null);
  if (current?.workspaceId === workspaceId && current?.boundAt) {
    return { ...current, changed: false };
  }

  await quarantinePendingQueues(current?.workspaceId || null, workspaceId);
  const next = {
    workspaceId,
    boundAt: new Date().toISOString()
  };
  await setSyncMeta(AUTH_WORKSPACE_BINDING_KEY, next);
  return { ...next, changed: true };
}

function localOnlyBelongsToCurrentBinding(inspection, binding) {
  if (!binding?.boundAt) return false;
  const boundAt = Date.parse(binding.boundAt);
  const createdAt = inspectionTimestamp(inspection);
  return Number.isFinite(boundAt) && createdAt >= boundAt;
}

async function ensureAuthenticatedClient() {
  const config = getSyncConfig();
  if (!config) throw new Error('Nenhum workspace autenticado está ativo.');
  const context = getAuthContext();
  if (!context?.userId) throw new Error('Sessão de usuário não disponível.');
  return { remote: getAuthClient(), config, context };
}

async function pullRemoteState(remote, config) {
  const [inspections, deletions] = await Promise.all([
    remote.rpc('docinspector_pull_inspections', { p_workspace_id: config.workspaceId }),
    remote.rpc('docinspector_pull_deletions', { p_workspace_id: config.workspaceId })
  ]);
  if (inspections.error) throw inspections.error;
  if (deletions.error) throw deletions.error;
  return { inspections: inspections.data || [], deletions: deletions.data || [] };
}

async function upsertRemote(remote, config, inspection) {
  const { data, error } = await remote.rpc('docinspector_upsert_inspection', {
    p_workspace_id: config.workspaceId,
    p_inspection_id: inspection.id,
    p_payload: inspection,
    p_device_id: getDeviceId()
  });
  if (error || data !== true) throw error || new Error('O servidor recusou a atualização da inspeção.');
}

async function flushPendingDeletions(remote, config) {
  const pending = await getSyncMeta(DELETIONS_KEY, []);
  if (!pending.length) return;
  const remaining = [];
  for (const id of pending) {
    const { data, error } = await remote.rpc('docinspector_delete_inspection', {
      p_workspace_id: config.workspaceId,
      p_inspection_id: id,
      p_device_id: getDeviceId()
    });
    if (error || data !== true) {
      remaining.push(id);
      if (error) throw error;
    }
  }
  if (remaining.length) await setSyncMeta(DELETIONS_KEY, remaining);
  else await deleteSyncMeta(DELETIONS_KEY);
}

async function flushPendingEvidenceDeletions(remote) {
  const pending = await getSyncMeta(EVIDENCE_DELETIONS_KEY, []);
  if (!pending.length) return;
  const { error } = await remote.storage.from(EVIDENCE_BUCKET).remove(pending);
  if (error) throw new Error(`Não foi possível remover evidências excluídas: ${error.message || 'falha desconhecida'}`);
  await deleteSyncMeta(EVIDENCE_DELETIONS_KEY);
}

function evidenceExtension(type = '') {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

async function syncPendingEvidence(remote, config, allowedInspectionIds) {
  const inspections = await listInspections();
  for (const inspection of inspections) {
    if (!allowedInspectionIds.has(inspection.id)) continue;
    let changed = false;
    for (const document of inspection.documents || []) {
      for (const copy of document.fieldCopies || []) {
        if (!copy.evidenceId || copy.evidencePath) continue;
        const evidence = await getEvidence(copy.evidenceId).catch(() => null);
        const folder = `${config.workspaceId}/${inspection.id}/${document.id}`;

        if (!evidence?.blob) {
          const { data: remoteFiles, error: listError } = await remote.storage
            .from(EVIDENCE_BUCKET)
            .list(folder, { limit: 20, search: `${copy.id}.` });
          if (listError) throw new Error(`Não foi possível localizar uma evidência na nuvem: ${listError.message || 'falha de consulta'}`);
          const remoteFile = (remoteFiles || []).find(file => ['jpg', 'png', 'webp'].some(ext => file?.name === `${copy.id}.${ext}`));
          if (remoteFile) {
            const recoveredAt = new Date().toISOString();
            copy.evidencePath = `${folder}/${remoteFile.name}`;
            copy.evidenceSyncedAt = copy.evidenceSyncedAt || recoveredAt;
            copy.evidenceRecoveredAt = recoveredAt;
            copy.updatedAt = recoveredAt;
            changed = true;
            continue;
          }
          const unavailableAt = new Date().toISOString();
          copy.evidenceUnavailableAt = unavailableAt;
          copy.evidenceUnavailableReason = 'arquivo fotográfico ausente no aparelho e no Storage';
          copy.evidenceOriginalId = copy.evidenceOriginalId || copy.evidenceId;
          copy.evidenceId = null;
          copy.updatedAt = unavailableAt;
          changed = true;
          continue;
        }

        const path = `${folder}/${copy.id}.${evidenceExtension(evidence.type || evidence.blob.type)}`;
        const attemptedAt = new Date().toISOString();
        const attempts = Math.max(0, Number(evidence.syncAttempts) || 0) + 1;
        const { error } = await remote.storage.from(EVIDENCE_BUCKET).upload(path, evidence.blob, {
          contentType: evidence.type || evidence.blob.type || 'image/jpeg',
          cacheControl: '3600',
          upsert: true
        });
        if (error) {
          await updateEvidence(copy.evidenceId, { syncAttempts: attempts, lastSyncAttemptAt: attemptedAt, lastSyncError: error.message || 'falha desconhecida' }).catch(() => {});
          throw new Error(`Não foi possível sincronizar uma evidência fotográfica: ${error.message || 'falha desconhecida'}`);
        }
        const syncedAt = new Date().toISOString();
        copy.evidencePath = path;
        copy.evidenceSyncedAt = syncedAt;
        copy.updatedAt = syncedAt;
        await updateEvidence(copy.evidenceId, { remotePath: path, syncedAt, syncAttempts: attempts, lastSyncAttemptAt: attemptedAt, lastSyncError: null }).catch(() => {});
        changed = true;
      }
    }
    if (changed) {
      inspection.updatedAt = new Date().toISOString();
      await saveInspection(inspection, { touch: false });
      await upsertRemote(remote, config, inspection);
    }
  }
}

async function performSyncCycle() {
  emitStatus({ state: 'syncing', label: 'Sincronizando…', error: null });
  try {
    const { remote, config } = await ensureAuthenticatedClient();
    if (navigator.onLine) await refreshAuthContext();
    const binding = await ensureWorkspaceBinding(config.workspaceId);
    await flushPendingDeletions(remote, config);
    await flushPendingEvidenceDeletions(remote);

    const localInspections = await listInspections();
    const localById = new Map(localInspections.map(item => [item.id, item]));
    const remoteState = await pullRemoteState(remote, config);
    const remoteById = new Map(
      remoteState.inspections
        .map(row => [row.id, hydrateInspection(row.payload)])
        .filter(([, inspection]) => Boolean(inspection))
    );

    const tombstones = new Set(remoteState.deletions.map(row => row.inspection_id));
    for (const id of tombstones) {
      if (localById.has(id)) await deleteInspection(id);
      localById.delete(id);
      remoteById.delete(id);
    }

    const allowedInspectionIds = new Set(remoteById.keys());
    let quarantinedLocalCount = 0;
    const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
    for (const id of allIds) {
      const local = localById.get(id) || null;
      const remoteInspection = remoteById.get(id) || null;
      if (!local && remoteInspection) {
        await saveInspection(remoteInspection, { touch: false });
        allowedInspectionIds.add(id);
        continue;
      }
      if (local && !remoteInspection) {
        if (!localOnlyBelongsToCurrentBinding(local, binding)) {
          quarantinedLocalCount += 1;
          continue;
        }
        await upsertRemote(remote, config, local);
        allowedInspectionIds.add(id);
        continue;
      }
      const merged = mergeInspection(local, remoteInspection);
      if (comparable(merged) !== comparable(local)) await saveInspection(merged, { touch: false });
      if (comparable(merged) !== comparable(remoteInspection)) await upsertRemote(remote, config, merged);
      allowedInspectionIds.add(id);
    }

    await syncPendingEvidence(remote, config, allowedInspectionIds);
    const lastSyncAt = new Date().toISOString();
    await setSyncMeta('last-sync-at', lastSyncAt);
    const label = quarantinedLocalCount
      ? `Sincronizado · ${quarantinedLocalCount} registro(s) local(is) isolado(s)`
      : 'Sincronizado';
    emitStatus({ state: 'synced', label, lastSyncAt, error: null, quarantinedLocalCount });
    window.dispatchEvent(new CustomEvent('sky17:sync-complete', { detail: { lastSyncAt, quarantinedLocalCount } }));
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    emitStatus({ state: 'error', label: 'Falha na sincronização', error: message });
    throw new Error(`Falha na sincronização: ${message}`);
  }
}

export function syncNow({ announce = false } = {}) {
  if (!authMode()) return legacy.syncNow({ announce });
  if (!getSyncConfig()) return Promise.resolve(false);
  if (!navigator.onLine) {
    emitStatus({ state: 'offline', label: 'Offline · salvo localmente', error: null });
    return Promise.resolve(false);
  }
  syncRequested = true;
  if (announce) announceRequested = true;
  if (activeSyncPromise) return activeSyncPromise;
  activeSyncPromise = (async () => {
    let result = false;
    while (syncRequested && navigator.onLine && getSyncConfig()) {
      syncRequested = false;
      announceRequested = false;
      result = await performSyncCycle();
    }
    return result;
  })().finally(() => { activeSyncPromise = null; });
  return activeSyncPromise;
}

export async function startSync() {
  if (!authMode()) return legacy.startSync();
  stopSync();
  if (!getSyncConfig()) {
    emitStatus({ state: 'local', label: 'Sem workspace', error: null });
    return;
  }
  const lastSyncAt = await getSyncMeta('last-sync-at', null).catch(() => null);
  emitStatus({ state: navigator.onLine ? 'syncing' : 'offline', label: navigator.onLine ? 'Sincronizando…' : 'Offline · salvo localmente', lastSyncAt, error: null });
  timer = window.setInterval(() => syncNow({ announce: false }).catch(() => {}), SYNC_INTERVAL_MS);
}

export function stopSync() {
  if (!authMode()) return legacy.stopSync();
  if (timer) window.clearInterval(timer);
  timer = null;
}

export function bindSyncLifecycle() {
  if (!authMode()) return legacy.bindSyncLifecycle();
  if (lifecycleBound) return;
  lifecycleBound = true;
  window.addEventListener('online', () => syncNow({ announce: false }).catch(() => {}));
  window.addEventListener('offline', () => emitStatus({ state: 'offline', label: 'Offline · salvo localmente', error: null }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) syncNow({ announce: false }).catch(() => {});
  });
}

export async function downloadRemoteEvidence(path) {
  if (!authMode()) return legacy.downloadRemoteEvidence(path);
  const normalized = String(path ?? '').trim();
  if (!normalized) throw new Error('Esta cópia não possui evidência sincronizada.');
  if (!navigator.onLine) throw new Error('A foto está na nuvem e este aparelho está offline. Conecte-se à internet para carregá-la.');
  const { remote } = await ensureAuthenticatedClient();
  const { data, error } = await remote.storage.from(EVIDENCE_BUCKET).download(normalized);
  if (error || !data) throw new Error(`Não foi possível baixar a evidência: ${error?.message || 'arquivo indisponível'}`);
  return data;
}

export async function testConfiguredSyncConnection() {
  if (!authMode()) return legacy.testConfiguredSyncConnection();
  if (!navigator.onLine) throw new Error('Conecte-se à internet para testar a sincronização.');
  const { remote, config, context } = await ensureAuthenticatedClient();
  const { error: readError } = await remote.rpc('docinspector_pull_inspections', { p_workspace_id: config.workspaceId });
  if (readError) throw new Error(`O workspace autenticado não pôde ser lido: ${readError.message || 'acesso negado'}`);
  const storageCheck = await remote.storage.from(EVIDENCE_BUCKET).list(config.workspaceId, { limit: 1 });
  if (storageCheck.error) throw new Error(`Storage de evidências indisponível: ${storageCheck.error.message || 'acesso negado'}`);
  return { url: AUTH_CONFIG.projectUrl, workspaceVerified: true, storageVerified: true, role: context.role };
}

export async function testSupabaseConnection(args) {
  if (!authMode()) return legacy.testSupabaseConnection(args);
  const context = await refreshAuthContext();
  if (!context) throw new Error('Sessão autenticada não disponível.');
  return { url: AUTH_CONFIG.projectUrl, workspaceVerified: true, role: context.role };
}

export async function createSyncWorkspace(args) {
  if (!authMode()) return legacy.createSyncWorkspace(args);
  throw new Error('A criação de workspaces é gerenciada pela conta do DocInspector.');
}

export async function connectWithCode(code) {
  if (!authMode()) return legacy.connectWithCode(code);
  throw new Error('Com autenticação ativa, o acesso ao workspace é definido pelo perfil do usuário.');
}

export function getConnectionCode() {
  if (!authMode()) return legacy.getConnectionCode();
  throw new Error('O código de sincronização legado não é utilizado com autenticação.');
}

export async function disconnectSync() {
  if (!authMode()) return legacy.disconnectSync();
  stopSync();
  emitStatus({ state: 'local', label: 'Sessão desconectada', lastSyncAt: null, error: null });
}
