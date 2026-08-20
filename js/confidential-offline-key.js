import { getAuthContext } from './auth-context.js';
import {
  CONFIDENTIAL_KEY_DB_NAME,
  getConfidentialKeyStatus,
  unlockConfidentialWorkspaceKey
} from './confidential-keyring.js';
import { importAes256Key, unwrapWorkspaceKeyForMember } from './confidential-crypto.js';
import { fromPostgresBytea } from './confidential-storage.js';

const DB_NAME = 'docinspector-confidential-envelopes-v1';
const DB_VERSION = 1;
const STORE = 'workspace-envelopes';
const MEMBER_KEY_STORE = 'member-private-keys';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function requirePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) throw new Error(`${label} inválido.`);
  return normalized;
}

function contextForWorkspace(workspaceId) {
  const context = getAuthContext();
  if (!context?.workspaceId || !context?.userId) throw new Error('Sessão autenticada não disponível para o cofre E2EE offline.');
  const normalizedWorkspaceId = requireUuid(workspaceId, 'workspaceId');
  if (requireUuid(context.workspaceId, 'workspaceId') !== normalizedWorkspaceId) {
    throw new Error('O workspace ativo não corresponde ao envelope E2EE local.');
  }
  return {
    ...context,
    workspaceId: normalizedWorkspaceId,
    userId: requireUuid(context.userId, 'userId')
  };
}

function requestDone(request, message) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(message));
  });
}

function transactionDone(transaction, message) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(message));
    transaction.onabort = () => reject(transaction.error || new Error(message));
  });
}

function openEnvelopeDb() {
  if (!globalThis.indexedDB) throw new Error('IndexedDB não está disponível para o envelope E2EE offline.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('memberScope', 'memberScope', { unique: false });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Falha ao abrir o cofre de envelopes E2EE.'));
    request.onblocked = () => reject(new Error('O cofre de envelopes E2EE está bloqueado por outra aba.'));
  });
}

async function withEnvelopeStore(mode, operation) {
  const db = await openEnvelopeDb();
  try {
    const transaction = db.transaction(STORE, mode);
    const result = await operation(transaction.objectStore(STORE));
    await transactionDone(transaction, 'Falha ao acessar o cofre de envelopes E2EE.');
    return result;
  } finally {
    db.close();
  }
}

function memberScope(workspaceId, userId) {
  return `${requireUuid(workspaceId, 'workspaceId')}:${requireUuid(userId, 'userId')}`;
}

function envelopeRecordId(workspaceId, userId, keyVersion) {
  return `${memberScope(workspaceId, userId)}:${requirePositiveInteger(keyVersion, 'workspaceKeyVersion')}`;
}

function prepareEnvelopeRecord({ context, status }) {
  const workspaceKey = status?.workspaceKey;
  const envelope = status?.envelope;
  if (!workspaceKey || workspaceKey.status !== 'ACTIVE' || !envelope) {
    throw new Error('Nenhum envelope de Workspace Key ativo está disponível para cache offline.');
  }
  const workspaceKeyVersion = requirePositiveInteger(workspaceKey.key_version, 'workspaceKeyVersion');
  const memberKeyVersion = requirePositiveInteger(envelope.member_key_version, 'memberKeyVersion');
  const wrapped = fromPostgresBytea(envelope.wrapped_workspace_key);
  if (wrapped.byteLength < 384) throw new Error('Envelope de Workspace Key inválido.');
  return {
    id: envelopeRecordId(context.workspaceId, context.userId, workspaceKeyVersion),
    memberScope: memberScope(context.workspaceId, context.userId),
    workspaceId: context.workspaceId,
    userId: context.userId,
    workspaceKeyVersion,
    memberKeyVersion,
    wrappedWorkspaceKey: wrapped.slice().buffer,
    cachedAt: new Date().toISOString()
  };
}

export async function cacheCurrentWorkspaceEnvelope({ workspaceId, status = null } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('O envelope da Workspace Key só pode ser atualizado online.');
  }
  const context = contextForWorkspace(workspaceId);
  const resolvedStatus = status || await getConfidentialKeyStatus({ workspaceId: context.workspaceId });
  const record = prepareEnvelopeRecord({ context, status: resolvedStatus });
  await withEnvelopeStore('readwrite', store => requestDone(
    store.put(record),
    'Falha ao salvar o envelope criptografado da Workspace Key.'
  ));
  return {
    workspaceId: record.workspaceId,
    userId: record.userId,
    workspaceKeyVersion: record.workspaceKeyVersion,
    memberKeyVersion: record.memberKeyVersion,
    cachedAt: record.cachedAt
  };
}

async function getCachedEnvelope({ workspaceId, userId, keyVersion = null }) {
  const scope = memberScope(workspaceId, userId);
  if (keyVersion != null) {
    return withEnvelopeStore('readonly', store => requestDone(
      store.get(envelopeRecordId(workspaceId, userId, keyVersion)),
      'Falha ao ler o envelope E2EE local.'
    ));
  }
  const rows = await withEnvelopeStore('readonly', store => requestDone(
    store.index('memberScope').getAll(scope),
    'Falha ao listar envelopes E2EE locais.'
  ));
  return (rows || []).sort((a, b) => Number(b.workspaceKeyVersion) - Number(a.workspaceKeyVersion))[0] || null;
}

async function loadMemberPrivateKey({ workspaceId, userId, keyVersion }) {
  if (!globalThis.indexedDB) throw new Error('IndexedDB não está disponível para a MEK local.');
  const id = `${requireUuid(workspaceId, 'workspaceId')}:${requireUuid(userId, 'userId')}:${requirePositiveInteger(keyVersion, 'memberKeyVersion')}`;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIDENTIAL_KEY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir o cofre local da MEK.'));
    request.onblocked = () => reject(new Error('O cofre local da MEK está bloqueado por outra aba.'));
  });
  try {
    if (!db.objectStoreNames.contains(MEMBER_KEY_STORE)) throw new Error('A MEK privada não está disponível neste aparelho.');
    const transaction = db.transaction(MEMBER_KEY_STORE, 'readonly');
    const record = await requestDone(transaction.objectStore(MEMBER_KEY_STORE).get(id), 'Falha ao ler a MEK privada local.');
    await transactionDone(transaction, 'Falha ao ler a MEK privada local.');
    const privateKey = record?.privateKey || null;
    if (!(privateKey instanceof CryptoKey) || privateKey.algorithm?.name !== 'RSA-OAEP' || privateKey.extractable) {
      throw new Error('A MEK privada local é inválida ou não está disponível.');
    }
    return privateKey;
  } finally {
    db.close();
  }
}

export async function unlockCachedWorkspaceKey({ workspaceId, keyVersion = null } = {}) {
  const context = contextForWorkspace(workspaceId);
  const envelope = await getCachedEnvelope({
    workspaceId: context.workspaceId,
    userId: context.userId,
    keyVersion
  });
  if (!envelope) throw new Error('A Workspace Key deste PDF ainda não foi preparada para uso offline neste aparelho.');
  const privateKey = await loadMemberPrivateKey({
    workspaceId: context.workspaceId,
    userId: context.userId,
    keyVersion: Number(envelope.memberKeyVersion)
  });
  const wrapped = new Uint8Array(envelope.wrappedWorkspaceKey);
  const raw = await unwrapWorkspaceKeyForMember(wrapped, privateKey);
  try {
    return {
      key: await importAes256Key(raw, { extractable: false }),
      keyVersion: Number(envelope.workspaceKeyVersion),
      source: 'offline-envelope'
    };
  } finally {
    raw.fill(0);
    wrapped.fill(0);
  }
}

export async function unlockConfidentialWorkspaceKeyResilient({ workspaceId, keyVersion = null } = {}) {
  const context = contextForWorkspace(workspaceId);
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    const unlocked = await unlockConfidentialWorkspaceKey({ workspaceId: context.workspaceId });
    await cacheCurrentWorkspaceEnvelope({ workspaceId: context.workspaceId }).catch(() => {});
    if (keyVersion != null && Number(unlocked.keyVersion) !== Number(keyVersion)) {
      throw new Error(`A WK ativa é v${unlocked.keyVersion}, mas este PDF requer WK v${keyVersion}.`);
    }
    return { ...unlocked, source: 'online-envelope' };
  }
  return unlockCachedWorkspaceKey({ workspaceId: context.workspaceId, keyVersion });
}

export async function hasCachedWorkspaceEnvelope({ workspaceId, keyVersion = null } = {}) {
  const context = contextForWorkspace(workspaceId);
  return Boolean(await getCachedEnvelope({
    workspaceId: context.workspaceId,
    userId: context.userId,
    keyVersion
  }).catch(() => null));
}

export async function clearCachedWorkspaceEnvelopes() {
  if (!globalThis.indexedDB) return;
  await withEnvelopeStore('readwrite', store => requestDone(store.clear(), 'Falha ao limpar envelopes E2EE locais.'));
}

export const CONFIDENTIAL_ENVELOPE_DB_NAME = DB_NAME;
