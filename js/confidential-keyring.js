import { getAuthClient } from './auth.js';
import { getAuthContext } from './auth-context.js';
import { ROLE } from './permissions.js';
import {
  CONFIDENTIAL_CRYPTO_VERSION,
  RECOVERY_SECRET_BYTES,
  encryptMemberPrivateKeyBackup,
  exportMemberPrivateKeyPkcs8,
  exportMemberPublicKeyJwk,
  generateMemberEncryptionKeyPair,
  generateRecoverySecret,
  generateWorkspaceKeyBytes,
  importAes256Key,
  importMemberPrivateKeyPkcs8,
  importMemberPublicKeyJwk,
  recoverMemberPrivateKey,
  unwrapWorkspaceKeyForMember,
  wrapWorkspaceKeyForMember
} from './confidential-crypto.js';
import { fromPostgresBytea, toPostgresBytea } from './confidential-storage.js';

const DB_NAME = 'docinspector-confidential-keys-v1';
const DB_VERSION = 1;
const STORE = 'member-private-keys';
const RECOVERY_PREFIX = 'DI-RS1-';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function asBytes(value, label = 'valor') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} deve ser binário.`);
}

function base64UrlEncode(value) {
  const bytes = asBytes(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Recovery Secret inválido.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeRecoverySecret(secret) {
  const bytes = asBytes(secret, 'Recovery Secret');
  if (bytes.byteLength !== RECOVERY_SECRET_BYTES) throw new Error('Recovery Secret inválido.');
  return `${RECOVERY_PREFIX}${base64UrlEncode(bytes)}`;
}

export function decodeRecoverySecret(value) {
  const text = String(value ?? '').trim();
  if (!text.startsWith(RECOVERY_PREFIX)) throw new Error('Recovery Secret inválido.');
  const bytes = base64UrlDecode(text.slice(RECOVERY_PREFIX.length));
  if (bytes.byteLength !== RECOVERY_SECRET_BYTES) throw new Error('Recovery Secret inválido.');
  return bytes;
}

function canonicalPublicJwk(jwk) {
  if (!jwk || typeof jwk !== 'object') throw new Error('JWK público inválido.');
  const canonical = {
    kty: String(jwk.kty ?? ''),
    n: String(jwk.n ?? ''),
    e: String(jwk.e ?? ''),
    alg: String(jwk.alg ?? 'RSA-OAEP-256'),
    ext: jwk.ext !== false,
    key_ops: Array.isArray(jwk.key_ops) ? [...jwk.key_ops].map(String).sort() : ['encrypt']
  };
  if (!canonical.kty || !canonical.n || !canonical.e) throw new Error('JWK público incompleto.');
  return canonical;
}

export async function fingerprintMemberPublicJwk(jwk) {
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalPublicJwk(jwk)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function requireOnlineContext(workspaceId, { admin = false } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('O gerenciamento de chaves E2EE exige conexão.');
  }
  const context = getAuthContext();
  if (!context?.userId || !context?.workspaceId) throw new Error('Sessão autenticada não disponível.');
  const normalizedWorkspaceId = requireUuid(workspaceId, 'workspaceId');
  if (requireUuid(context.workspaceId, 'workspaceId') !== normalizedWorkspaceId) {
    throw new Error('O workspace ativo não corresponde ao gerenciamento de chaves.');
  }
  if (admin && context.role !== ROLE.ADMIN) throw new Error('Somente ADMIN pode distribuir ou rotacionar chaves do workspace.');
  return { ...context, workspaceId: normalizedWorkspaceId };
}

function keyRecordId({ workspaceId, userId, keyVersion }) {
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) throw new Error('keyVersion inválido.');
  return `${requireUuid(workspaceId, 'workspaceId')}:${requireUuid(userId, 'userId')}:${keyVersion}`;
}

function assertIndexedDb() {
  if (!globalThis.indexedDB) throw new Error('IndexedDB não está disponível para armazenar a chave privada local.');
}

function requestDone(request, message) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(message));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao persistir a chave privada local.'));
    transaction.onabort = () => reject(transaction.error || new Error('Persistência da chave privada foi cancelada.'));
  });
}

function openKeyDb() {
  assertIndexedDb();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Falha ao abrir o cofre local de chaves.'));
    request.onblocked = () => reject(new Error('O cofre local de chaves está bloqueado por outra aba.'));
  });
}

async function withKeyStore(mode, operation) {
  const db = await openKeyDb();
  try {
    const transaction = db.transaction(STORE, mode);
    const result = await operation(transaction.objectStore(STORE));
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

async function storeLocalPrivateKey({ workspaceId, userId, keyVersion, privateKey }) {
  if (!(privateKey instanceof CryptoKey) || privateKey.algorithm?.name !== 'RSA-OAEP' || privateKey.extractable) {
    throw new Error('A chave privada local deve ser RSA-OAEP não extraível.');
  }
  const id = keyRecordId({ workspaceId, userId, keyVersion });
  await withKeyStore('readwrite', store => requestDone(store.put({
    id,
    workspaceId: requireUuid(workspaceId, 'workspaceId'),
    userId: requireUuid(userId, 'userId'),
    keyVersion,
    privateKey,
    storedAt: new Date().toISOString()
  }), 'Falha ao armazenar a chave privada local.'));
}

async function loadLocalPrivateKey({ workspaceId, userId, keyVersion }) {
  const id = keyRecordId({ workspaceId, userId, keyVersion });
  const record = await withKeyStore('readonly', store => requestDone(store.get(id), 'Falha ao ler a chave privada local.'));
  return record?.privateKey || null;
}

export async function clearLocalConfidentialKeys() {
  if (!globalThis.indexedDB) return;
  await withKeyStore('readwrite', store => requestDone(store.clear(), 'Falha ao limpar as chaves privadas locais.'));
}

async function nextMemberKeyVersion(client, workspaceId, userId) {
  const response = await client
    .from('docinspector_member_public_keys')
    .select('key_version')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('key_version', { ascending: false })
    .limit(1);
  if (response.error) throw new Error('Não foi possível consultar versões anteriores da MEK.');
  return Number(response.data?.[0]?.key_version || 0) + 1;
}

async function getCurrentWorkspaceKeyRow(client, workspaceId) {
  const response = await client
    .from('docinspector_workspace_crypto_keys')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('status', ['ACTIVE', 'ROTATING'])
    .order('key_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (response.error) throw new Error('Não foi possível consultar a chave criptográfica do workspace.');
  return response.data || null;
}

export async function getConfidentialKeyStatus({ workspaceId }) {
  const context = requireOnlineContext(workspaceId);
  const client = getAuthClient();
  const [publicKeyResponse, workspaceKey] = await Promise.all([
    client
      .from('docinspector_member_public_keys')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.userId)
      .eq('status', 'ACTIVE')
      .maybeSingle(),
    getCurrentWorkspaceKeyRow(client, context.workspaceId)
  ]);
  if (publicKeyResponse.error) throw new Error('Não foi possível consultar sua chave pública E2EE.');
  const publicKey = publicKeyResponse.data || null;
  let envelope = null;
  let backup = null;
  let localPrivateKey = false;
  if (publicKey) {
    const [backupResponse, envelopeResponse] = await Promise.all([
      client
        .from('docinspector_member_key_backups')
        .select('workspace_id,user_id,key_version,crypto_version,updated_at')
        .eq('workspace_id', context.workspaceId)
        .eq('user_id', context.userId)
        .eq('key_version', publicKey.key_version)
        .maybeSingle(),
      workspaceKey
        ? client
          .from('docinspector_workspace_key_envelopes')
          .select('workspace_id,key_version,member_user_id,member_key_version,wrapped_workspace_key,created_at')
          .eq('workspace_id', context.workspaceId)
          .eq('key_version', workspaceKey.key_version)
          .eq('member_user_id', context.userId)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);
    if (backupResponse.error || envelopeResponse.error) throw new Error('Não foi possível consultar o estado E2EE desta conta.');
    backup = backupResponse.data || null;
    envelope = envelopeResponse.data || null;
    localPrivateKey = Boolean(await loadLocalPrivateKey({
      workspaceId: context.workspaceId,
      userId: context.userId,
      keyVersion: Number(publicKey.key_version)
    }).catch(() => null));
  }
  return {
    enrolled: Boolean(publicKey && backup),
    localPrivateKey,
    cryptoReady: Boolean(publicKey && backup && workspaceKey?.status === 'ACTIVE' && envelope),
    publicKey,
    backup,
    workspaceKey,
    envelope
  };
}

async function initializeWorkspaceKeyForAdmin({ client, context, publicKey, keyVersion }) {
  const existing = await getCurrentWorkspaceKeyRow(client, context.workspaceId);
  if (existing) return existing;

  const workspaceKeyBytes = generateWorkspaceKeyBytes();
  let wrapped = null;
  try {
    const importedPublic = await importMemberPublicKeyJwk(publicKey);
    wrapped = await wrapWorkspaceKeyForMember(workspaceKeyBytes, importedPublic);
    const initialized = await client.rpc('docinspector_initialize_workspace_crypto', {
      p_workspace_id: context.workspaceId,
      p_member_key_version: keyVersion,
      p_wrapped_workspace_key: toPostgresBytea(wrapped)
    });
    if (initialized.error || !Number(initialized.data)) {
      throw new Error('Não foi possível inicializar a Workspace Key de forma atômica.');
    }
    return {
      workspace_id: context.workspaceId,
      key_version: Number(initialized.data),
      status: 'ACTIVE'
    };
  } finally {
    workspaceKeyBytes.fill(0);
    wrapped?.fill(0);
  }
}

export async function enrollConfidentialMember({ workspaceId }) {
  const context = requireOnlineContext(workspaceId);
  const client = getAuthClient();
  const current = await client
    .from('docinspector_member_public_keys')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.userId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  if (current.error) throw new Error('Não foi possível consultar o provisionamento E2EE atual.');
  if (current.data) throw new Error('Esta conta já possui uma MEK ativa neste workspace. Use recuperação em vez de gerar outra chave.');

  const keyVersion = await nextMemberKeyVersion(client, context.workspaceId, context.userId);
  const pair = await generateMemberEncryptionKeyPair();
  const recoverySecretBytes = generateRecoverySecret();
  const publicJwk = await exportMemberPublicKeyJwk(pair.publicKey);
  const fingerprint = await fingerprintMemberPublicJwk(publicJwk);
  const backup = await encryptMemberPrivateKeyBackup(pair.privateKey, recoverySecretBytes);
  const pkcs8 = await exportMemberPrivateKeyPkcs8(pair.privateKey);
  let normalPrivateKey;
  try {
    normalPrivateKey = await importMemberPrivateKeyPkcs8(pkcs8, { extractable: false });
  } finally {
    pkcs8.fill(0);
  }

  const publicInsert = await client.from('docinspector_member_public_keys').insert({
    workspace_id: context.workspaceId,
    user_id: context.userId,
    key_version: keyVersion,
    public_jwk: publicJwk,
    fingerprint_sha256: fingerprint,
    status: 'ACTIVE'
  });
  if (publicInsert.error) {
    recoverySecretBytes.fill(0);
    throw new Error('Não foi possível publicar sua chave pública E2EE.');
  }

  const backupInsert = await client.from('docinspector_member_key_backups').insert({
    workspace_id: context.workspaceId,
    user_id: context.userId,
    key_version: keyVersion,
    crypto_version: 'MEK-BACKUP-v1',
    encrypted_private_key: toPostgresBytea(backup.ciphertext),
    hkdf_salt: toPostgresBytea(backup.salt),
    iv: toPostgresBytea(backup.iv)
  });
  if (backupInsert.error) {
    await client.from('docinspector_member_public_keys')
      .update({ status: 'REVOKED', revoked_at: new Date().toISOString() })
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.userId)
      .eq('key_version', keyVersion);
    recoverySecretBytes.fill(0);
    throw new Error('Não foi possível salvar o backup criptografado da chave privada; o provisionamento foi revertido.');
  }

  try {
    await storeLocalPrivateKey({
      workspaceId: context.workspaceId,
      userId: context.userId,
      keyVersion,
      privateKey: normalPrivateKey
    });
  } catch (error) {
    await client.from('docinspector_member_public_keys')
      .update({ status: 'REVOKED', revoked_at: new Date().toISOString() })
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.userId)
      .eq('key_version', keyVersion);
    recoverySecretBytes.fill(0);
    throw error;
  }

  const recoverySecret = encodeRecoverySecret(recoverySecretBytes);
  recoverySecretBytes.fill(0);

  let workspaceKey = await getCurrentWorkspaceKeyRow(client, context.workspaceId);
  let workspaceInitializationError = null;
  if (!workspaceKey && context.role === ROLE.ADMIN) {
    try {
      workspaceKey = await initializeWorkspaceKeyForAdmin({ client, context, publicKey: publicJwk, keyVersion });
    } catch (error) {
      workspaceInitializationError = String(error?.message || error || 'Falha ao inicializar a Workspace Key.');
    }
  }

  const status = await getConfidentialKeyStatus({ workspaceId: context.workspaceId });
  return {
    ...status,
    recoverySecret,
    keyVersion,
    workspaceKeyVersion: Number(workspaceKey?.key_version || 0) || null,
    workspaceInitializationError
  };
}

export async function recoverConfidentialMemberKey({ workspaceId, recoverySecret }) {
  const context = requireOnlineContext(workspaceId);
  const client = getAuthClient();
  const publicResponse = await client
    .from('docinspector_member_public_keys')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.userId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  if (publicResponse.error || !publicResponse.data) throw new Error('Nenhuma MEK ativa foi encontrada para recuperação.');
  const publicKey = publicResponse.data;
  const backupResponse = await client
    .from('docinspector_member_key_backups')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.userId)
    .eq('key_version', publicKey.key_version)
    .maybeSingle();
  if (backupResponse.error || !backupResponse.data) throw new Error('O backup criptografado da MEK não foi encontrado.');

  const secret = decodeRecoverySecret(recoverySecret);
  try {
    const privateKey = await recoverMemberPrivateKey({
      version: CONFIDENTIAL_CRYPTO_VERSION,
      salt: fromPostgresBytea(backupResponse.data.hkdf_salt),
      iv: fromPostgresBytea(backupResponse.data.iv),
      ciphertext: fromPostgresBytea(backupResponse.data.encrypted_private_key)
    }, secret, { extractable: false });
    await storeLocalPrivateKey({
      workspaceId: context.workspaceId,
      userId: context.userId,
      keyVersion: Number(publicKey.key_version),
      privateKey
    });
  } finally {
    secret.fill(0);
  }
  return getConfidentialKeyStatus({ workspaceId: context.workspaceId });
}

export async function unwrapConfidentialWorkspaceKeyBytes({ workspaceId }) {
  const context = requireOnlineContext(workspaceId);
  const status = await getConfidentialKeyStatus({ workspaceId: context.workspaceId });
  if (!status.publicKey || !status.workspaceKey || status.workspaceKey.status !== 'ACTIVE' || !status.envelope) {
    throw new Error('Este membro ainda não possui acesso criptográfico ativo ao workspace.');
  }
  const privateKey = await loadLocalPrivateKey({
    workspaceId: context.workspaceId,
    userId: context.userId,
    keyVersion: Number(status.publicKey.key_version)
  });
  if (!privateKey) throw new Error('A chave privada E2EE não está disponível neste aparelho. Use o Recovery Secret para recuperá-la.');
  return {
    bytes: await unwrapWorkspaceKeyForMember(fromPostgresBytea(status.envelope.wrapped_workspace_key), privateKey),
    keyVersion: Number(status.workspaceKey.key_version)
  };
}

export async function unlockConfidentialWorkspaceKey({ workspaceId }) {
  const unlocked = await unwrapConfidentialWorkspaceKeyBytes({ workspaceId });
  try {
    return {
      key: await importAes256Key(unlocked.bytes, { extractable: false }),
      keyVersion: unlocked.keyVersion
    };
  } finally {
    unlocked.bytes.fill(0);
  }
}

export async function listWorkspaceCryptoTargets({ workspaceId }) {
  const context = requireOnlineContext(workspaceId, { admin: true });
  const client = getAuthClient();
  const response = await client.rpc('docinspector_crypto_key_targets', { p_workspace_id: context.workspaceId });
  if (response.error) throw new Error('Não foi possível listar membros aptos ao provisionamento E2EE.');
  return response.data || [];
}

export async function grantWorkspaceKeyToMember({ workspaceId, targetUserId, workspaceKeyBytes }) {
  const context = requireOnlineContext(workspaceId, { admin: true });
  const client = getAuthClient();
  const activeWorkspaceKey = await getCurrentWorkspaceKeyRow(client, context.workspaceId);
  if (!activeWorkspaceKey || activeWorkspaceKey.status !== 'ACTIVE') throw new Error('O workspace não possui uma Workspace Key ativa.');
  const targets = await listWorkspaceCryptoTargets({ workspaceId: context.workspaceId });
  const target = targets.find(item => String(item.user_id) === requireUuid(targetUserId, 'targetUserId'));
  if (!target) throw new Error('O membro alvo não está ativo ou ainda não publicou uma MEK.');

  const importedPublic = await importMemberPublicKeyJwk(target.public_jwk);
  const rawWorkspaceKey = asBytes(workspaceKeyBytes, 'Workspace Key');
  if (rawWorkspaceKey.byteLength !== 32) throw new Error('Workspace Key inválida.');
  const wrapped = await wrapWorkspaceKeyForMember(rawWorkspaceKey, importedPublic);
  try {
    const response = await client.from('docinspector_workspace_key_envelopes').insert({
      workspace_id: context.workspaceId,
      key_version: Number(activeWorkspaceKey.key_version),
      member_user_id: requireUuid(target.user_id, 'targetUserId'),
      member_key_version: Number(target.key_version),
      wrapped_workspace_key: toPostgresBytea(wrapped),
      created_by: context.userId
    });
    if (response.error) {
      if (String(response.error.code || '') === '23505') return true;
      throw new Error('Não foi possível conceder a Workspace Key ao membro.');
    }
    return true;
  } finally {
    wrapped.fill(0);
  }
}

export const CONFIDENTIAL_KEY_DB_NAME = DB_NAME;
