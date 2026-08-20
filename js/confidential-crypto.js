const textEncoder = new TextEncoder();

export const CONFIDENTIAL_CRYPTO_VERSION = 1;
export const PDF_CONTAINER_VERSION = 'DIPDF1';
export const AES_KEY_BYTES = 32;
export const AES_GCM_IV_BYTES = 12;
export const RECOVERY_SECRET_BYTES = 32;
export const RECOVERY_SALT_BYTES = 16;

const MEMBER_KEY_ALGORITHM = Object.freeze({
  name: 'RSA-OAEP',
  modulusLength: 3072,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256'
});

const RECOVERY_CONTEXT = 'docinspector:member-private-key-backup:v1';
const FILE_KEY_CONTEXT = 'docinspector:file-key-envelope:v1';

function webCrypto() {
  const api = globalThis.crypto;
  if (!api?.subtle || typeof api.getRandomValues !== 'function') {
    throw new Error('Web Crypto API indisponível neste ambiente.');
  }
  return api;
}

function bytes(value, label = 'valor') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} deve ser binário.`);
}

function exactBytes(value, expected, label) {
  const result = bytes(value, label);
  if (result.byteLength !== expected) {
    throw new Error(`${label} deve ter exatamente ${expected} bytes.`);
  }
  return result;
}

function randomBytes(length) {
  const value = new Uint8Array(length);
  webCrypto().getRandomValues(value);
  return value;
}

function requiredText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} é obrigatório.`);
  return normalized;
}

function requiredPositiveInteger(value, label, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

function aesGcmParams(iv, additionalData = null) {
  const params = {
    name: 'AES-GCM',
    iv: exactBytes(iv, AES_GCM_IV_BYTES, 'IV AES-GCM'),
    tagLength: 128
  };
  if (additionalData != null) params.additionalData = bytes(additionalData, 'AAD');
  return params;
}

function assertRsaKey(key, usage) {
  if (!(key instanceof CryptoKey) || key.algorithm?.name !== 'RSA-OAEP' || !key.usages.includes(usage)) {
    throw new Error(`Chave RSA-OAEP inválida para ${usage}.`);
  }
}

function assertAesKey(key, usage) {
  if (!(key instanceof CryptoKey) || key.algorithm?.name !== 'AES-GCM' || !key.usages.includes(usage)) {
    throw new Error(`Chave AES-GCM inválida para ${usage}.`);
  }
}

export function generateRecoverySecret() {
  return randomBytes(RECOVERY_SECRET_BYTES);
}

export function generateWorkspaceKeyBytes() {
  return randomBytes(AES_KEY_BYTES);
}

export function generateFileKeyBytes() {
  return randomBytes(AES_KEY_BYTES);
}

export async function generateMemberEncryptionKeyPair() {
  return webCrypto().subtle.generateKey(MEMBER_KEY_ALGORITHM, true, ['encrypt', 'decrypt']);
}

export async function exportMemberPublicKeyJwk(publicKey) {
  assertRsaKey(publicKey, 'encrypt');
  return webCrypto().subtle.exportKey('jwk', publicKey);
}

export async function importMemberPublicKeyJwk(jwk) {
  if (!jwk || typeof jwk !== 'object') throw new TypeError('JWK público inválido.');
  return webCrypto().subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

export async function exportMemberPrivateKeyPkcs8(privateKey) {
  assertRsaKey(privateKey, 'decrypt');
  if (!privateKey.extractable) throw new Error('A chave privada não é exportável.');
  return new Uint8Array(await webCrypto().subtle.exportKey('pkcs8', privateKey));
}

export async function importMemberPrivateKeyPkcs8(pkcs8, { extractable = false } = {}) {
  return webCrypto().subtle.importKey(
    'pkcs8',
    bytes(pkcs8, 'PKCS8'),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    Boolean(extractable),
    ['decrypt']
  );
}

export async function importAes256Key(rawKey, { extractable = false } = {}) {
  return webCrypto().subtle.importKey(
    'raw',
    exactBytes(rawKey, AES_KEY_BYTES, 'Chave AES-256'),
    { name: 'AES-GCM' },
    Boolean(extractable),
    ['encrypt', 'decrypt']
  );
}

export async function encryptAesGcm(plaintext, key, { additionalData = null, iv = null } = {}) {
  assertAesKey(key, 'encrypt');
  const actualIv = iv == null ? randomBytes(AES_GCM_IV_BYTES) : exactBytes(iv, AES_GCM_IV_BYTES, 'IV AES-GCM');
  const ciphertext = await webCrypto().subtle.encrypt(
    aesGcmParams(actualIv, additionalData),
    key,
    bytes(plaintext, 'plaintext')
  );
  return { iv: new Uint8Array(actualIv), ciphertext: new Uint8Array(ciphertext) };
}

export async function decryptAesGcm(envelope, key, { additionalData = null } = {}) {
  assertAesKey(key, 'decrypt');
  if (!envelope || typeof envelope !== 'object') throw new TypeError('Envelope AES-GCM inválido.');
  const plaintext = await webCrypto().subtle.decrypt(
    aesGcmParams(envelope.iv, additionalData),
    key,
    bytes(envelope.ciphertext, 'ciphertext')
  );
  return new Uint8Array(plaintext);
}

export async function wrapWorkspaceKeyForMember(workspaceKeyBytes, memberPublicKey) {
  assertRsaKey(memberPublicKey, 'encrypt');
  const wrapped = await webCrypto().subtle.encrypt(
    { name: 'RSA-OAEP' },
    memberPublicKey,
    exactBytes(workspaceKeyBytes, AES_KEY_BYTES, 'Workspace Key')
  );
  return new Uint8Array(wrapped);
}

export async function unwrapWorkspaceKeyForMember(wrappedWorkspaceKey, memberPrivateKey) {
  assertRsaKey(memberPrivateKey, 'decrypt');
  const raw = new Uint8Array(await webCrypto().subtle.decrypt(
    { name: 'RSA-OAEP' },
    memberPrivateKey,
    bytes(wrappedWorkspaceKey, 'Workspace Key envelope')
  ));
  return exactBytes(raw, AES_KEY_BYTES, 'Workspace Key decriptada');
}

function fileKeyAad({ workspaceId, fileId, keyVersion }) {
  const payload = [
    FILE_KEY_CONTEXT,
    requiredText(workspaceId, 'workspaceId'),
    requiredText(fileId, 'fileId'),
    requiredPositiveInteger(keyVersion, 'keyVersion')
  ];
  return textEncoder.encode(JSON.stringify(payload));
}

export async function encryptFileKeyEnvelope(fileKeyBytes, workspaceKey, context) {
  return encryptAesGcm(fileKeyBytes, workspaceKey, { additionalData: fileKeyAad(context) });
}

export async function decryptFileKeyEnvelope(envelope, workspaceKey, context) {
  const raw = await decryptAesGcm(envelope, workspaceKey, { additionalData: fileKeyAad(context) });
  return exactBytes(raw, AES_KEY_BYTES, 'File Encryption Key decriptada');
}

export async function rewrapFileKeyEnvelope(envelope, oldWorkspaceKey, newWorkspaceKey, { from, to }) {
  const fileKey = await decryptFileKeyEnvelope(envelope, oldWorkspaceKey, from);
  try {
    return await encryptFileKeyEnvelope(fileKey, newWorkspaceKey, to);
  } finally {
    fileKey.fill(0);
  }
}

export function buildPdfChunkAdditionalData({
  formatVersion = PDF_CONTAINER_VERSION,
  workspaceId,
  inspectionId,
  fileId,
  chunkIndex,
  totalChunks
}) {
  const total = requiredPositiveInteger(totalChunks, 'totalChunks');
  const index = requiredPositiveInteger(chunkIndex, 'chunkIndex', { allowZero: true });
  if (index >= total) throw new Error('chunkIndex deve ser menor que totalChunks.');
  const payload = [
    requiredText(formatVersion, 'formatVersion'),
    requiredText(workspaceId, 'workspaceId'),
    requiredText(inspectionId, 'inspectionId'),
    requiredText(fileId, 'fileId'),
    index,
    total
  ];
  return textEncoder.encode(JSON.stringify(payload));
}

export async function encryptPdfChunk(plaintext, fileKey, context) {
  return encryptAesGcm(plaintext, fileKey, {
    additionalData: buildPdfChunkAdditionalData(context)
  });
}

export async function decryptPdfChunk(envelope, fileKey, context) {
  return decryptAesGcm(envelope, fileKey, {
    additionalData: buildPdfChunkAdditionalData(context)
  });
}

async function deriveRecoveryBackupKey(recoverySecret, salt) {
  const secret = exactBytes(recoverySecret, RECOVERY_SECRET_BYTES, 'Recovery Secret');
  const hkdfKey = await webCrypto().subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return webCrypto().subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: exactBytes(salt, RECOVERY_SALT_BYTES, 'HKDF salt'),
      info: textEncoder.encode(RECOVERY_CONTEXT)
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMemberPrivateKeyBackup(privateKey, recoverySecret) {
  const salt = randomBytes(RECOVERY_SALT_BYTES);
  const backupKey = await deriveRecoveryBackupKey(recoverySecret, salt);
  const pkcs8 = await exportMemberPrivateKeyPkcs8(privateKey);
  try {
    const encrypted = await encryptAesGcm(pkcs8, backupKey, {
      additionalData: textEncoder.encode(RECOVERY_CONTEXT)
    });
    return {
      version: CONFIDENTIAL_CRYPTO_VERSION,
      salt,
      iv: encrypted.iv,
      ciphertext: encrypted.ciphertext
    };
  } finally {
    pkcs8.fill(0);
  }
}

export async function recoverMemberPrivateKey(backup, recoverySecret, { extractable = false } = {}) {
  if (!backup || backup.version !== CONFIDENTIAL_CRYPTO_VERSION) {
    throw new Error('Versão de backup criptográfico não suportada.');
  }
  const backupKey = await deriveRecoveryBackupKey(recoverySecret, backup.salt);
  const pkcs8 = await decryptAesGcm(backup, backupKey, {
    additionalData: textEncoder.encode(RECOVERY_CONTEXT)
  });
  try {
    return await importMemberPrivateKeyPkcs8(pkcs8, { extractable });
  } finally {
    pkcs8.fill(0);
  }
}
