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
import { hydrateDocument, hydrateInspection, normalize, recalculateDocument } from './domain.js';

const CONFIG_KEY = 'sky17-sync-config-v1';
const DEVICE_KEY = 'sky17-device-id';
const DELETIONS_KEY = 'pending-deletions';
const EVIDENCE_DELETIONS_KEY = 'pending-evidence-deletions';
const SYNC_INTERVAL_MS = 30000;
const REQUIRED_SCHEMA_VERSION = 6;
const EVIDENCE_BUCKET = 'docinspector-evidence';

let client = null;
let channel = null;
let timer = null;
let activeSyncPromise = null;
let syncRequested = false;
let announceRequested = false;
let lifecycleBound = false;
let lastStatus = { state: 'local', label: 'Somente local', lastSyncAt: null, error: null };

function emitStatus(next) {
  lastStatus = { ...lastStatus, ...next };
  window.dispatchEvent(new CustomEvent('sky17:sync-status', { detail: lastStatus }));
}

function requireSupabaseLibrary() {
  if (!globalThis.supabase?.createClient) {
    throw new Error('A biblioteca do Supabase não foi carregada. Conecte-se à internet e recarregue a página uma vez.');
  }
}

/**
 * Aceita os formatos que o painel do Supabase costuma exibir:
 * - Project URL: https://projeto.supabase.co
 * - Data API URL: https://projeto.supabase.co/rest/v1/
 * - somente o Project ID/ref: projeto
 * e sempre converte para a Project URL esperada pelo createClient.
 */
export function normalizeSupabaseUrl(value) {
  const raw = normalize(value);
  if (!raw) throw new Error('Informe a Project URL do Supabase.');
  if (raw.length > 500) throw new Error('A Project URL informada é muito longa.');

  if (/^[a-z0-9]{15,40}$/i.test(raw)) {
    return `https://${raw.toLowerCase()}.supabase.co`;
  }

  let parsed;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('Informe uma Project URL válida do Supabase.');
  }

  if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)) {
    throw new Error('Informe uma URL do projeto Supabase no formato https://seu-projeto.supabase.co.');
  }

  return `https://${parsed.hostname.toLowerCase()}`;
}

function sanitizePublishableKey(value) {
  const key = normalize(value);
  if (key.length < 20 || key.length > 4096) throw new Error('Informe uma Publishable Key válida do Supabase.');
  return key;
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function textToBase64Url(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64UrlToText(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

async function hashText(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    if (crypto.randomUUID) {
      id = crypto.randomUUID();
    } else {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getSyncConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (!parsed?.url || !parsed?.publishableKey || !parsed?.workspaceId || !parsed?.syncKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getSyncStatus() {
  return { ...lastStatus, configured: Boolean(getSyncConfig()) };
}

function persistConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  return config;
}

function buildClient(config) {
  requireSupabaseLibrary();
  const workspaceHeaders = config?.workspaceId && config?.syncKey
    ? {
        'x-docinspector-workspace': config.workspaceId,
        'x-docinspector-secret': config.syncKey
      }
    : {};

  return globalThis.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: workspaceHeaders },
    realtime: { params: { eventsPerSecond: 5 } }
  });
}

async function ensureClient() {
  const config = getSyncConfig();
  if (!config) throw new Error('Sincronização não configurada.');
  if (!client) client = buildClient(config);
  return { client, config };
}

function schemaSetupError() {
  return new Error('O banco Supabase ainda não está preparado para o DocInspector. Execute o arquivo SUPABASE-SETUP.sql no SQL Editor e tente novamente.');
}

async function assertSchema(remote) {
  const { data, error } = await remote.rpc('sky17_schema_version');
  if (error) throw schemaSetupError();
  if (Number(data) < REQUIRED_SCHEMA_VERSION) {
    throw new Error('O schema do Supabase está desatualizado. Execute novamente o arquivo SUPABASE-SETUP.sql no SQL Editor.');
  }
}

export async function testSupabaseConnection({ url, publishableKey }) {
  const config = {
    url: normalizeSupabaseUrl(url),
    publishableKey: sanitizePublishableKey(publishableKey)
  };
  const remote = buildClient(config);
  await assertSchema(remote);
  return { url: config.url, schemaVersion: REQUIRED_SCHEMA_VERSION };
}

export async function testConfiguredSyncConnection() {
  const config = getSyncConfig();
  if (!config) throw new Error('Sincronização não configurada.');
  if (!navigator.onLine) throw new Error('Este aparelho está offline. Conecte-se à internet para testar a sincronização.');

  const remote = buildClient(config);
  await assertSchema(remote);
  const { data, error } = await remote.rpc('sky17_verify_workspace', {
    p_workspace_id: config.workspaceId,
    p_secret: config.syncKey
  });
  if (error || data !== true) throw new Error('O espaço configurado não pôde ser autenticado no Supabase.');

  const storageCheck = await remote.storage.from(EVIDENCE_BUCKET).list(config.workspaceId, { limit: 1 });
  if (storageCheck.error) {
    throw new Error(`Banco conectado, mas o Storage de evidências não está acessível: ${storageCheck.error.message || 'falha desconhecida'}`);
  }

  const probePath = `${config.workspaceId}/.health/${crypto.randomUUID()}.png`;
  const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), char => char.charCodeAt(0));
  const probeBlob = new Blob([pngBytes], { type: 'image/png' });

  const uploadProbe = await remote.storage.from(EVIDENCE_BUCKET).upload(probePath, probeBlob, {
    contentType: 'image/png',
    cacheControl: '60',
    upsert: false
  });
  if (uploadProbe.error) {
    throw new Error(`Storage acessível para leitura, mas sem permissão de gravação de evidências: ${uploadProbe.error.message || 'falha desconhecida'}`);
  }

  const deleteProbe = await remote.storage.from(EVIDENCE_BUCKET).remove([probePath]);
  if (deleteProbe.error) {
    throw new Error(`O Storage gravou o teste, mas não permitiu removê-lo: ${deleteProbe.error.message || 'falha desconhecida'}`);
  }

  return {
    url: config.url,
    schemaVersion: REQUIRED_SCHEMA_VERSION,
    workspaceVerified: true,
    storageVerified: true,
    storageWriteVerified: true,
    storageDeleteVerified: true
  };
}

export async function createSyncWorkspace({ url, publishableKey, name }) {
  const config = {
    url: normalizeSupabaseUrl(url),
    publishableKey: sanitizePublishableKey(publishableKey),
    workspaceId: crypto.randomUUID(),
    syncKey: randomSecret(),
    workspaceName: normalize(name) || 'DocInspector',
    configuredAt: new Date().toISOString()
  };

  const tempClient = buildClient(config);
  await assertSchema(tempClient);
  const { data, error } = await tempClient.rpc('sky17_create_workspace', {
    p_workspace_id: config.workspaceId,
    p_name: config.workspaceName,
    p_secret: config.syncKey
  });
  if (error || data !== true) {
    throw new Error(`Não foi possível criar o espaço no Supabase: ${error?.message || 'resposta inválida do servidor'}`);
  }

  persistConfig(config);
  client = tempClient;
  await startSync();
  await syncNow({ announce: true });
  return config;
}

export async function connectWithCode(code) {
  const normalizedCode = normalize(code);
  if (!normalizedCode || normalizedCode.length > 8192) throw new Error('Código de sincronização inválido.');
  let raw;
  try {
    raw = JSON.parse(base64UrlToText(normalizedCode));
  } catch {
    throw new Error('Código de sincronização inválido.');
  }

  if (!raw || typeof raw !== 'object' || Number(raw.version) !== 2) {
    throw new Error('Código de sincronização incompatível com esta versão do DocInspector.');
  }

  const config = {
    url: normalizeSupabaseUrl(raw.url),
    publishableKey: sanitizePublishableKey(raw.publishableKey),
    workspaceId: normalize(raw.workspaceId),
    syncKey: normalize(raw.syncKey),
    workspaceName: normalize(raw.workspaceName) || 'DocInspector',
    configuredAt: new Date().toISOString()
  };

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(config.workspaceId)) {
    throw new Error('Código de sincronização com identificador inválido.');
  }
  if (config.syncKey.length < 32 || config.syncKey.length > 256) throw new Error('Código de sincronização incompleto ou inválido.');

  const tempClient = buildClient(config);
  await assertSchema(tempClient);
  const { data, error } = await tempClient.rpc('sky17_verify_workspace', {
    p_workspace_id: config.workspaceId,
    p_secret: config.syncKey
  });
  if (error || data !== true) throw new Error('Não foi possível validar este espaço de sincronização.');

  persistConfig(config);
  client = tempClient;
  await startSync();
  await syncNow({ announce: false });
  return config;
}

export function getConnectionCode() {
  const config = getSyncConfig();
  if (!config) throw new Error('Sincronização não configurada.');
  return textToBase64Url(JSON.stringify({
    version: 2,
    url: config.url,
    publishableKey: config.publishableKey,
    workspaceId: config.workspaceId,
    syncKey: config.syncKey,
    workspaceName: config.workspaceName
  }));
}

export async function disconnectSync() {
  stopSync();
  localStorage.removeItem(CONFIG_KEY);
  client = null;
  emitStatus({ state: 'local', label: 'Somente local', lastSyncAt: null, error: null });
}

export async function queueRemoteDeletion(id) {
  if (!id || !getSyncConfig()) return;
  const pending = new Set(await getSyncMeta(DELETIONS_KEY, []));
  pending.add(id);
  await setSyncMeta(DELETIONS_KEY, [...pending]);
}

export async function queueEvidenceDeletion(path) {
  const normalizedPath = normalize(path);
  if (!normalizedPath || !getSyncConfig()) return;
  const pending = new Set(await getSyncMeta(EVIDENCE_DELETIONS_KEY, []));
  pending.add(normalizedPath);
  await setSyncMeta(EVIDENCE_DELETIONS_KEY, [...pending]);
}

function newestFieldCopy(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = Date.parse(a.updatedAt || a.capturedAt || '') || 0;
  const bTime = Date.parse(b.updatedAt || b.capturedAt || '') || 0;
  return aTime > bTime ? a : b;
}

function newestDocument(a, b) {
  if (!a) return hydrateDocument(b);
  if (!b) return hydrateDocument(a);

  const left = hydrateDocument(a);
  const right = hydrateDocument(b);
  const aTime = Date.parse(left.updatedAt || left.verifiedAt || '') || 0;
  const bTime = Date.parse(right.updatedAt || right.verifiedAt || '') || 0;
  const base = bTime > aTime ? right : left;

  const deletedCopyIds = new Set([...(left.deletedCopyIds || []), ...(right.deletedCopyIds || [])]);
  const copies = new Map();
  for (const copy of left.fieldCopies || []) {
    if (!deletedCopyIds.has(copy.id)) copies.set(copy.id, copy);
  }
  for (const copy of right.fieldCopies || []) {
    if (!deletedCopyIds.has(copy.id)) copies.set(copy.id, newestFieldCopy(copies.get(copy.id), copy));
  }

  const merged = hydrateDocument({
    ...base,
    id: left.id || right.id,
    fieldCopies: [...copies.values()],
    deletedCopyIds: [...deletedCopyIds],
    result: copies.size ? 'Pendente' : base.result
  });
  return copies.size || deletedCopyIds.size ? recalculateDocument(merged) : merged;
}

function mergeDeletedDocuments(local = [], remote = [], deletedIds = new Set()) {
  const byId = new Map();
  for (const entry of [...local, ...remote]) {
    const id = entry?.document?.id;
    if (!id || !deletedIds.has(id)) continue;
    const previous = byId.get(id);
    const previousTime = Date.parse(previous?.deletedAt || '') || 0;
    const nextTime = Date.parse(entry?.deletedAt || '') || 0;
    if (!previous || nextTime >= previousTime) byId.set(id, structuredClone(entry));
  }
  return [...byId.values()];
}

function mergeDocumentAudit(local = [], remote = []) {
  const byId = new Map();
  for (const event of [...local, ...remote]) {
    if (!event?.id) continue;
    const previous = byId.get(event.id);
    const previousTime = Date.parse(previous?.at || '') || 0;
    const nextTime = Date.parse(event?.at || '') || 0;
    if (!previous || nextTime >= previousTime) byId.set(event.id, structuredClone(event));
  }
  return [...byId.values()]
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    .slice(-1000);
}

export function mergeInspection(localInspection, remoteInspection) {
  if (!localInspection) return hydrateInspection(remoteInspection);
  if (!remoteInspection) return hydrateInspection(localInspection);

  const local = hydrateInspection(localInspection);
  const remote = hydrateInspection(remoteInspection);
  const localTime = Date.parse(local.updatedAt) || 0;
  const remoteTime = Date.parse(remote.updatedAt) || 0;
  const base = remoteTime > localTime ? remote : local;
  const deletedDocumentIds = new Set([...(local.deletedDocumentIds || []), ...(remote.deletedDocumentIds || [])]);

  const byId = new Map();
  for (const document of local.documents) {
    if (!deletedDocumentIds.has(document.id)) byId.set(document.id, document);
  }
  for (const document of remote.documents) {
    if (deletedDocumentIds.has(document.id)) continue;
    const exact = byId.get(document.id);
    if (exact) {
      byId.set(document.id, newestDocument(exact, document));
      continue;
    }

    const sameCode = [...byId.values()].filter(candidate => candidate.code === document.code);
    if (sameCode.length === 1) {
      const existing = sameCode[0];
      byId.set(existing.id, newestDocument(existing, { ...document, id: existing.id }));
    } else {
      byId.set(document.id, document);
    }
  }

  return {
    ...base,
    id: local.id,
    createdAt: local.createdAt || remote.createdAt,
    updatedAt: new Date(Math.max(localTime, remoteTime)).toISOString(),
    documents: [...byId.values()].filter(document => !deletedDocumentIds.has(document.id)),
    deletedDocumentIds: [...deletedDocumentIds],
    deletedDocuments: mergeDeletedDocuments(local.deletedDocuments, remote.deletedDocuments, deletedDocumentIds),
    documentAudit: mergeDocumentAudit(local.documentAudit, remote.documentAudit)
  };
}

function comparable(inspection) {
  const copy = structuredClone(inspection);
  copy.documents.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const document of copy.documents) {
    if (Array.isArray(document.fieldCopies)) document.fieldCopies.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (Array.isArray(document.deletedCopyIds)) document.deletedCopyIds.sort((a, b) => String(a).localeCompare(String(b)));
  }
  if (Array.isArray(copy.deletedDocumentIds)) copy.deletedDocumentIds.sort((a, b) => String(a).localeCompare(String(b)));
  if (Array.isArray(copy.deletedDocuments)) copy.deletedDocuments.sort((a, b) => String(a?.document?.id).localeCompare(String(b?.document?.id)));
  if (Array.isArray(copy.documentAudit)) copy.documentAudit.sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  return JSON.stringify(copy);
}

async function pullRemoteState(remote, config) {
  const [inspectionResponse, deletionResponse] = await Promise.all([
    remote.rpc('sky17_pull_inspections', {
      p_workspace_id: config.workspaceId,
      p_secret: config.syncKey
    }),
    remote.rpc('sky17_pull_deletions', {
      p_workspace_id: config.workspaceId,
      p_secret: config.syncKey
    })
  ]);

  if (inspectionResponse.error) throw inspectionResponse.error;
  if (deletionResponse.error) throw deletionResponse.error;
  return {
    inspections: inspectionResponse.data || [],
    deletions: deletionResponse.data || []
  };
}

async function flushPendingDeletions(remote, config) {
  const pending = await getSyncMeta(DELETIONS_KEY, []);
  if (!pending.length) return;

  const remaining = [];
  for (const id of pending) {
    const { data, error } = await remote.rpc('sky17_delete_inspection', {
      p_workspace_id: config.workspaceId,
      p_secret: config.syncKey,
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

async function upsertRemote(remote, config, inspection) {
  const { data, error } = await remote.rpc('sky17_upsert_inspection', {
    p_workspace_id: config.workspaceId,
    p_secret: config.syncKey,
    p_inspection_id: inspection.id,
    p_payload: inspection,
    p_device_id: getDeviceId()
  });
  if (error || data !== true) throw error || new Error('O Supabase recusou a atualização da inspeção.');
}

function safeEvidenceExtension(type = '') {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

function evidencePath(config, inspection, document, copy, evidence) {
  const extension = safeEvidenceExtension(evidence?.type || evidence?.blob?.type);
  return `${config.workspaceId}/${inspection.id}/${document.id}/${copy.id}.${extension}`;
}

async function syncPendingEvidence(remote, config) {
  const inspections = await listInspections();
  const failures = [];
  let uploaded = 0;

  for (const inspection of inspections) {
    let inspectionChanged = false;

    for (const document of inspection.documents || []) {
      for (const copy of document.fieldCopies || []) {
        if (!copy.evidenceId || copy.evidencePath) continue;

        const evidence = await getEvidence(copy.evidenceId).catch(() => null);
        const attemptedAt = new Date().toISOString();

        if (!evidence?.blob) {
          const folder = `${config.workspaceId}/${inspection.id}/${document.id}`;
          const { data: remoteFiles, error: listError } = await remote.storage
            .from(EVIDENCE_BUCKET)
            .list(folder, { limit: 20, search: `${copy.id}.` });

          if (!listError) {
            const remoteFile = (remoteFiles || []).find(file =>
              file?.name === `${copy.id}.jpg` || file?.name === `${copy.id}.png` || file?.name === `${copy.id}.webp`
            );
            if (remoteFile) {
              const recoveredAt = new Date().toISOString();
              copy.evidencePath = `${folder}/${remoteFile.name}`;
              copy.evidenceSyncedAt = copy.evidenceSyncedAt || recoveredAt;
              copy.evidenceRecoveredAt = recoveredAt;
              copy.updatedAt = recoveredAt;
              copy.evidenceUnavailableAt = null;
              copy.evidenceUnavailableReason = null;
              inspectionChanged = true;
              continue;
            }
          }

          if (listError) {
            failures.push({
              inspectionId: inspection.id,
              documentId: document.id,
              copyId: copy.id,
              evidenceId: copy.evidenceId,
              message: `arquivo local ausente e o Storage não pôde ser consultado: ${listError.message || 'falha de consulta'}`
            });
            continue;
          }

          const unavailableAt = new Date().toISOString();
          copy.evidenceUnavailableAt = unavailableAt;
          copy.evidenceUnavailableReason = 'arquivo fotográfico ausente no aparelho e no Storage';
          copy.evidenceOriginalId = copy.evidenceOriginalId || copy.evidenceId;
          copy.evidenceId = null;
          copy.updatedAt = unavailableAt;
          inspectionChanged = true;
          continue;
        }

        const attempts = Math.max(0, Number(evidence.syncAttempts) || 0) + 1;
        const path = evidencePath(config, inspection, document, copy, evidence);
        const { error } = await remote.storage
          .from(EVIDENCE_BUCKET)
          .upload(path, evidence.blob, {
            contentType: evidence.type || evidence.blob.type || 'image/jpeg',
            cacheControl: '3600',
            upsert: true
          });

        if (error) {
          const message = error.message || 'falha desconhecida';
          await updateEvidence(copy.evidenceId, {
            syncAttempts: attempts,
            lastSyncAttemptAt: attemptedAt,
            lastSyncError: message
          }).catch(() => {});
          failures.push({
            inspectionId: inspection.id,
            documentId: document.id,
            copyId: copy.id,
            evidenceId: copy.evidenceId,
            message
          });
          continue;
        }

        const syncedAt = new Date().toISOString();
        copy.evidencePath = path;
        copy.evidenceSyncedAt = syncedAt;
        copy.updatedAt = syncedAt;
        await updateEvidence(copy.evidenceId, {
          remotePath: path,
          syncedAt,
          syncAttempts: attempts,
          lastSyncAttemptAt: attemptedAt,
          lastSyncError: null
        }).catch(() => {});
        inspectionChanged = true;
        uploaded += 1;
      }
    }

    if (inspectionChanged) {
      inspection.updatedAt = new Date().toISOString();
      await saveInspection(inspection, { touch: false });
      await upsertRemote(remote, config, inspection);
    }
  }

  if (failures.length) {
    const first = failures[0];
    const suffix = failures.length > 1 ? ` Há ${failures.length} evidências pendentes.` : '';
    throw new Error(`Não foi possível sincronizar uma evidência fotográfica: ${first.message}.${suffix}`.replace('..', '.'));
  }

  return { uploaded, failed: 0 };
}

export async function downloadRemoteEvidence(path) {
  const normalizedPath = normalize(path);
  if (!normalizedPath) throw new Error('Esta cópia não possui evidência sincronizada.');

  if (!navigator.onLine) {
    throw new Error('A foto está na nuvem e este aparelho está offline. Conecte-se à internet para carregá-la.');
  }

  const { client: remote } = await ensureClient();
  const { data, error } = await remote.storage.from(EVIDENCE_BUCKET).download(normalizedPath);
  if (error || !data) {
    throw new Error(`Não foi possível baixar a evidência: ${error?.message || 'arquivo indisponível'}`);
  }
  return data;
}

async function performSyncCycle({ announce = false } = {}) {
  emitStatus({ state: 'syncing', label: 'Sincronizando…', error: null });

  try {
    const { client: remote, config } = await ensureClient();
    await assertSchema(remote);
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

    const allIds = new Set([...localById.keys(), ...remoteById.keys()]);

    for (const id of allIds) {
      const local = localById.get(id) || null;
      const remoteInspection = remoteById.get(id) || null;

      if (!local && remoteInspection) {
        await saveInspection(remoteInspection, { touch: false });
        continue;
      }
      if (local && !remoteInspection) {
        await upsertRemote(remote, config, local);
        continue;
      }

      const merged = mergeInspection(local, remoteInspection);
      const differsLocal = comparable(merged) !== comparable(local);
      const differsRemote = comparable(merged) !== comparable(remoteInspection);
      if (differsLocal) await saveInspection(merged, { touch: false });
      if (differsRemote) await upsertRemote(remote, config, merged);
    }

    await syncPendingEvidence(remote, config);

    const lastSyncAt = new Date().toISOString();
    await setSyncMeta('last-sync-at', lastSyncAt);
    emitStatus({ state: 'synced', label: 'Sincronizado', lastSyncAt, error: null });
    window.dispatchEvent(new CustomEvent('sky17:sync-complete', { detail: { lastSyncAt } }));

    if (announce && channel) {
      channel.send({
        type: 'broadcast',
        event: 'changed',
        payload: { deviceId: getDeviceId(), at: lastSyncAt }
      }).catch(() => {});
    }
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    emitStatus({ state: 'error', label: 'Falha na sincronização', error: message });
    throw new Error(`Falha na sincronização: ${message}`);
  }
}

export function syncNow({ announce = false } = {}) {
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
      const announceThisCycle = announceRequested;
      announceRequested = false;
      result = await performSyncCycle({ announce: announceThisCycle });
    }
    return result;
  })().finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
}

async function setupRealtime() {
  const config = getSyncConfig();
  if (!config) return;
  const { client: remote } = await ensureClient();
  const channelToken = (await hashText(`${config.workspaceId}:${config.syncKey}`)).slice(0, 40);

  if (channel) await remote.removeChannel(channel);
  channel = remote
    .channel(`sky17-${channelToken}`, { config: { broadcast: { ack: false, self: false } } })
    .on('broadcast', { event: 'changed' }, message => {
      if (message?.payload?.deviceId === getDeviceId()) return;
      syncNow({ announce: false }).catch(() => {});
    })
    .subscribe();
}

export async function startSync() {
  stopSync();
  if (!getSyncConfig()) {
    emitStatus({ state: 'local', label: 'Somente local', error: null });
    return;
  }

  client = buildClient(getSyncConfig());
  const lastSyncAt = await getSyncMeta('last-sync-at', null).catch(() => null);
  emitStatus({
    state: navigator.onLine ? 'syncing' : 'offline',
    label: navigator.onLine ? 'Sincronizando…' : 'Offline · salvo localmente',
    lastSyncAt,
    error: null
  });

  await setupRealtime().catch(() => {});
  timer = window.setInterval(() => syncNow({ announce: false }).catch(() => {}), SYNC_INTERVAL_MS);
}

export function stopSync() {
  if (timer) window.clearInterval(timer);
  timer = null;
  if (client && channel) client.removeChannel(channel).catch(() => {});
  channel = null;
}

export function bindSyncLifecycle() {
  if (lifecycleBound) return;
  lifecycleBound = true;
  window.addEventListener('online', () => syncNow({ announce: false }).catch(() => {}));
  window.addEventListener('offline', () => emitStatus({ state: 'offline', label: 'Offline · salvo localmente', error: null }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      syncNow({ announce: false }).catch(() => {});
    }
  });
}
