import { getAuthClient } from './auth.js';
import { getAuthContext } from './auth-context.js';
import { ROLE } from './permissions.js';
import {
  AES_GCM_IV_BYTES,
  generateWorkspaceKeyBytes,
  importAes256Key,
  importMemberPublicKeyJwk,
  rewrapFileKeyEnvelope,
  unwrapWorkspaceKeyForMember,
  wrapWorkspaceKeyForMember
} from './confidential-crypto.js';
import { fromPostgresBytea, toPostgresBytea } from './confidential-storage.js';
import { CONFIDENTIAL_KEY_DB_NAME, listWorkspaceCryptoTargets } from './confidential-keyring.js';

const MEMBER_KEY_STORE = 'member-private-keys';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REWRAP_BATCH_SIZE = 50;

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

function asBytes(value, label = 'valor') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} deve ser binário.`);
}

function concatBytes(parts) {
  const arrays = parts.map(part => asBytes(part));
  const total = arrays.reduce((sum, item) => sum + item.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const item of arrays) {
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
}

function requireAdminContext(workspaceId) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Remoção de membros e rotação E2EE exigem conexão.');
  }
  const context = getAuthContext();
  if (!context?.userId || !context?.workspaceId) throw new Error('Sessão autenticada não disponível.');
  const normalizedWorkspaceId = requireUuid(workspaceId, 'workspaceId');
  if (requireUuid(context.workspaceId, 'workspaceId') !== normalizedWorkspaceId) {
    throw new Error('O workspace ativo não corresponde à rotação E2EE.');
  }
  if (context.role !== ROLE.ADMIN) throw new Error('Somente ADMIN pode remover membros e rotacionar a Workspace Key.');
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

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao ler o cofre local de chaves.'));
    transaction.onabort = () => reject(transaction.error || new Error('Leitura do cofre local de chaves foi cancelada.'));
  });
}

async function loadLocalPrivateKey({ workspaceId, userId, keyVersion }) {
  if (!globalThis.indexedDB) throw new Error('IndexedDB não está disponível para desbloquear a chave privada local.');
  const id = `${requireUuid(workspaceId, 'workspaceId')}:${requireUuid(userId, 'userId')}:${requirePositiveInteger(keyVersion, 'keyVersion')}`;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIDENTIAL_KEY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir o cofre local de chaves.'));
    request.onblocked = () => reject(new Error('O cofre local de chaves está bloqueado por outra aba.'));
  });
  try {
    if (!db.objectStoreNames.contains(MEMBER_KEY_STORE)) throw new Error('O cofre local de chaves ainda não foi provisionado.');
    const transaction = db.transaction(MEMBER_KEY_STORE, 'readonly');
    const record = await requestDone(transaction.objectStore(MEMBER_KEY_STORE).get(id), 'Falha ao ler a chave privada local.');
    await transactionDone(transaction);
    const privateKey = record?.privateKey || null;
    if (!(privateKey instanceof CryptoKey) || privateKey.algorithm?.name !== 'RSA-OAEP' || privateKey.extractable) {
      throw new Error('A chave privada E2EE necessária não está disponível neste aparelho.');
    }
    return privateKey;
  } finally {
    db.close();
  }
}

async function getActiveWorkspaceKey(client, workspaceId) {
  const response = await client
    .from('docinspector_workspace_crypto_keys')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  if (response.error) throw new Error('Não foi possível consultar a Workspace Key ativa.');
  if (!response.data) throw new Error('O workspace não possui uma Workspace Key ativa.');
  return response.data;
}

async function getOwnActivePublicKey(client, context) {
  const response = await client
    .from('docinspector_member_public_keys')
    .select('workspace_id,user_id,key_version,public_jwk,status')
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.userId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  if (response.error || !response.data) throw new Error('O ADMIN atual ainda não possui uma MEK ativa.');
  return response.data;
}

async function unwrapWorkspaceKeyVersionBytes({ client, context, keyVersion }) {
  const version = requirePositiveInteger(keyVersion, 'keyVersion');
  const envelopeResponse = await client
    .from('docinspector_workspace_key_envelopes')
    .select('workspace_id,key_version,member_user_id,member_key_version,wrapped_workspace_key')
    .eq('workspace_id', context.workspaceId)
    .eq('key_version', version)
    .eq('member_user_id', context.userId)
    .maybeSingle();
  if (envelopeResponse.error || !envelopeResponse.data) {
    throw new Error(`O ADMIN atual não possui envelope da Workspace Key v${version}.`);
  }
  const envelope = envelopeResponse.data;
  const privateKey = await loadLocalPrivateKey({
    workspaceId: context.workspaceId,
    userId: context.userId,
    keyVersion: Number(envelope.member_key_version)
  });
  return unwrapWorkspaceKeyForMember(fromPostgresBytea(envelope.wrapped_workspace_key), privateKey);
}

function splitFileKeyEnvelopeBytea(value) {
  const bytes = fromPostgresBytea(value);
  if (bytes.byteLength <= AES_GCM_IV_BYTES + 16) throw new Error('Envelope FEK inválido.');
  return {
    iv: bytes.slice(0, AES_GCM_IV_BYTES),
    ciphertext: bytes.slice(AES_GCM_IV_BYTES)
  };
}

export async function rewrapConfidentialFileKeyBytea({
  wrappedFileKey,
  oldWorkspaceKey,
  newWorkspaceKey,
  workspaceId,
  fileId,
  fromKeyVersion,
  toKeyVersion
}) {
  const normalizedWorkspaceId = requireUuid(workspaceId, 'workspaceId');
  const normalizedFileId = requireUuid(fileId, 'fileId');
  const fromVersion = requirePositiveInteger(fromKeyVersion, 'fromKeyVersion');
  const toVersion = requirePositiveInteger(toKeyVersion, 'toKeyVersion');
  if (toVersion <= fromVersion) throw new Error('toKeyVersion deve ser maior que fromKeyVersion.');
  const rotated = await rewrapFileKeyEnvelope(
    splitFileKeyEnvelopeBytea(wrappedFileKey),
    oldWorkspaceKey,
    newWorkspaceKey,
    {
      from: { workspaceId: normalizedWorkspaceId, fileId: normalizedFileId, keyVersion: fromVersion },
      to: { workspaceId: normalizedWorkspaceId, fileId: normalizedFileId, keyVersion: toVersion }
    }
  );
  return toPostgresBytea(concatBytes([rotated.iv, rotated.ciphertext]));
}

export async function getWorkspaceRotationStatus({ workspaceId }) {
  const context = requireAdminContext(workspaceId);
  const client = getAuthClient();
  const response = await client.rpc('docinspector_workspace_rotation_status', {
    p_workspace_id: context.workspaceId
  });
  if (response.error) throw new Error('Não foi possível consultar o estado da rotação E2EE.');
  return response.data?.[0] || null;
}

async function grantRotatingWorkspaceKey({ client, context, toKeyVersion, newWorkspaceKeyBytes, onProgress }) {
  const targets = await listWorkspaceCryptoTargets({ workspaceId: context.workspaceId });
  const activeTargets = targets.filter(item => item?.public_jwk && Number(item?.key_version) > 0);
  let completed = 0;
  for (const target of activeTargets) {
    const importedPublic = await importMemberPublicKeyJwk(target.public_jwk);
    const wrapped = await wrapWorkspaceKeyForMember(newWorkspaceKeyBytes, importedPublic);
    try {
      const insert = await client.from('docinspector_workspace_key_envelopes').insert({
        workspace_id: context.workspaceId,
        key_version: toKeyVersion,
        member_user_id: requireUuid(target.user_id, 'targetUserId'),
        member_key_version: requirePositiveInteger(Number(target.key_version), 'memberKeyVersion'),
        wrapped_workspace_key: toPostgresBytea(wrapped),
        created_by: context.userId
      });
      if (insert.error && String(insert.error.code || '') !== '23505') {
        throw new Error('Não foi possível distribuir a nova Workspace Key a todos os membros ativos.');
      }
    } finally {
      wrapped.fill(0);
    }
    completed += 1;
    onProgress?.({ stage: 'granting', completed, total: activeTargets.length });
  }
}

async function rewrapRemainingDocuments({
  client,
  context,
  fromKeyVersion,
  toKeyVersion,
  oldWorkspaceKey,
  newWorkspaceKey,
  onProgress
}) {
  let processed = 0;
  for (;;) {
    const response = await client
      .from('docinspector_project_documents')
      .select('id,wrapped_file_key,workspace_key_version')
      .eq('workspace_id', context.workspaceId)
      .eq('status', 'ACTIVE')
      .eq('workspace_key_version', fromKeyVersion)
      .order('id', { ascending: true })
      .limit(REWRAP_BATCH_SIZE);
    if (response.error) throw new Error('Não foi possível listar os PDFs pendentes de rotação.');
    const documents = response.data || [];
    if (!documents.length) break;

    for (const document of documents) {
      const fileId = requireUuid(document.id, 'fileId');
      const wrappedFileKey = await rewrapConfidentialFileKeyBytea({
        wrappedFileKey: document.wrapped_file_key,
        oldWorkspaceKey,
        newWorkspaceKey,
        workspaceId: context.workspaceId,
        fileId,
        fromKeyVersion,
        toKeyVersion
      });
      const rotated = await client.rpc('docinspector_rewrap_confidential_file_key', {
        p_workspace_id: context.workspaceId,
        p_file_id: fileId,
        p_from_key_version: fromKeyVersion,
        p_to_key_version: toKeyVersion,
        p_wrapped_file_key: wrappedFileKey
      });
      if (rotated.error) throw new Error('Não foi possível persistir o rewrap da FEK de um PDF confidencial.');
      processed += rotated.data === false ? 0 : 1;
      onProgress?.({ stage: 'rewrapping', completed: processed });
    }
  }
  return processed;
}

async function continueRotationWithRawKeys({
  client,
  context,
  rotation,
  oldWorkspaceKeyBytes,
  newWorkspaceKeyBytes,
  onProgress
}) {
  const fromKeyVersion = requirePositiveInteger(Number(rotation.from_key_version), 'fromKeyVersion');
  const toKeyVersion = requirePositiveInteger(Number(rotation.to_key_version), 'toKeyVersion');
  const oldWorkspaceKey = await importAes256Key(oldWorkspaceKeyBytes, { extractable: false });
  const newWorkspaceKey = await importAes256Key(newWorkspaceKeyBytes, { extractable: false });

  onProgress?.({ stage: 'granting', completed: 0 });
  await grantRotatingWorkspaceKey({
    client,
    context,
    toKeyVersion,
    newWorkspaceKeyBytes,
    onProgress
  });

  onProgress?.({ stage: 'rewrapping', completed: Number(rotation.processed_documents || 0), total: Number(rotation.total_documents || 0) });
  await rewrapRemainingDocuments({
    client,
    context,
    fromKeyVersion,
    toKeyVersion,
    oldWorkspaceKey,
    newWorkspaceKey,
    onProgress
  });

  onProgress?.({ stage: 'finishing' });
  const finished = await client.rpc('docinspector_finish_workspace_rotation', {
    p_workspace_id: context.workspaceId,
    p_from_key_version: fromKeyVersion,
    p_to_key_version: toKeyVersion
  });
  if (finished.error || finished.data !== true) throw new Error('A rotação E2EE não pôde ser finalizada.');
  onProgress?.({ stage: 'completed', fromKeyVersion, toKeyVersion });
  return { fromKeyVersion, toKeyVersion, completed: true };
}

export async function resumeWorkspaceKeyRotation({ workspaceId, onProgress } = {}) {
  const context = requireAdminContext(workspaceId);
  const client = getAuthClient();
  const rotation = await getWorkspaceRotationStatus({ workspaceId: context.workspaceId });
  if (!rotation || rotation.status !== 'ROTATING') throw new Error('Não existe rotação E2EE pendente neste workspace.');

  const oldWorkspaceKeyBytes = await unwrapWorkspaceKeyVersionBytes({
    client,
    context,
    keyVersion: Number(rotation.from_key_version)
  });
  const newWorkspaceKeyBytes = await unwrapWorkspaceKeyVersionBytes({
    client,
    context,
    keyVersion: Number(rotation.to_key_version)
  });

  try {
    return await continueRotationWithRawKeys({
      client,
      context,
      rotation,
      oldWorkspaceKeyBytes,
      newWorkspaceKeyBytes,
      onProgress
    });
  } finally {
    oldWorkspaceKeyBytes.fill(0);
    newWorkspaceKeyBytes.fill(0);
  }
}

export async function removeMemberAndRotateWorkspaceKey({ workspaceId, removedUserId, onProgress } = {}) {
  const context = requireAdminContext(workspaceId);
  const targetUserId = requireUuid(removedUserId, 'removedUserId');
  if (targetUserId === context.userId) throw new Error('Use outro ADMIN para remover esta conta do workspace.');
  const client = getAuthClient();
  const [activeWorkspaceKey, ownPublicKey] = await Promise.all([
    getActiveWorkspaceKey(client, context.workspaceId),
    getOwnActivePublicKey(client, context)
  ]);
  const fromKeyVersion = requirePositiveInteger(Number(activeWorkspaceKey.key_version), 'fromKeyVersion');
  const oldWorkspaceKeyBytes = await unwrapWorkspaceKeyVersionBytes({ client, context, keyVersion: fromKeyVersion });
  const newWorkspaceKeyBytes = generateWorkspaceKeyBytes();
  let wrappedForAdmin = null;

  try {
    const importedPublic = await importMemberPublicKeyJwk(ownPublicKey.public_jwk);
    wrappedForAdmin = await wrapWorkspaceKeyForMember(newWorkspaceKeyBytes, importedPublic);
    onProgress?.({ stage: 'starting', fromKeyVersion });
    const begun = await client.rpc('docinspector_begin_member_removal_rotation', {
      p_workspace_id: context.workspaceId,
      p_removed_user_id: targetUserId,
      p_from_key_version: fromKeyVersion,
      p_member_key_version: Number(ownPublicKey.key_version),
      p_wrapped_workspace_key: toPostgresBytea(wrappedForAdmin)
    });
    if (begun.error || !Number(begun.data)) {
      throw new Error('Não foi possível iniciar a remoção segura e a rotação da Workspace Key.');
    }
    const toKeyVersion = Number(begun.data);
    const rotation = {
      workspace_id: context.workspaceId,
      from_key_version: fromKeyVersion,
      to_key_version: toKeyVersion,
      removed_user_id: targetUserId,
      status: 'ROTATING',
      processed_documents: 0,
      total_documents: 0
    };
    const status = await getWorkspaceRotationStatus({ workspaceId: context.workspaceId });
    if (status?.status === 'ROTATING' && Number(status.to_key_version) === toKeyVersion) Object.assign(rotation, status);

    return await continueRotationWithRawKeys({
      client,
      context,
      rotation,
      oldWorkspaceKeyBytes,
      newWorkspaceKeyBytes,
      onProgress
    });
  } finally {
    wrappedForAdmin?.fill(0);
    oldWorkspaceKeyBytes.fill(0);
    newWorkspaceKeyBytes.fill(0);
  }
}
