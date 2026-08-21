const DB_NAME = 'docinspector-confidential-vault-v1';
const DB_VERSION = 1;
const STORE = 'ciphertext';
const MIME = 'application/octet-stream';
const VERSION = 'DIPDF1';
const MAGIC = new TextEncoder().encode(`${VERSION}\n`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BANNED_FIELDS = new Set([
  'plaintext',
  'filename',
  'title',
  'description',
  'workspacekey',
  'filekey',
  'privatekey',
  'recoverysecret'
]);
const DOCUMENT_FIELDS = Object.freeze([
  'id',
  'workspace_id',
  'inspection_id',
  'document_id',
  'object_path',
  'crypto_version',
  'workspace_key_version',
  'wrapped_file_key',
  'metadata_ciphertext',
  'metadata_iv',
  'plaintext_size',
  'ciphertext_size',
  'chunk_count',
  'ciphertext_sha256',
  'status',
  'created_by',
  'created_at',
  'updated_at',
  'deleted_at'
]);

function asBytes(value, label = 'valor') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) throw new TypeError(`${label} deve ser convertido de Blob antes da validação.`);
  throw new TypeError(`${label} deve ser binário.`);
}

function uuid(value, label) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(normalized)) throw new Error(`${label} inválido.`);
  return normalized;
}

function assertNoPlaintextFields(value, path = 'registro') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (BANNED_FIELDS.has(normalizedKey)) {
      throw new Error(`${path} contém campo plaintext proibido: ${key}.`);
    }
    if (child && typeof child === 'object' && !(child instanceof Blob) && !(child instanceof ArrayBuffer) && !ArrayBuffer.isView(child)) {
      assertNoPlaintextFields(child, `${path}.${key}`);
    }
  }
}

function expectedObjectPath(document) {
  return `${uuid(document.workspace_id, 'workspaceId')}/${uuid(document.inspection_id, 'inspectionId')}/${uuid(document.id, 'fileId')}.dipdf`;
}

function sanitizeDocument(document) {
  if (!document || typeof document !== 'object') throw new Error('Metadados criptografados do documento são obrigatórios.');
  assertNoPlaintextFields(document, 'document');
  if (document.crypto_version !== VERSION) throw new Error('Versão criptográfica do documento não suportada.');
  if (document.status && document.status !== 'ACTIVE') throw new Error('Somente PDFs confidenciais ativos podem ser mantidos no cache offline.');
  const expectedPath = expectedObjectPath(document);
  if (String(document.object_path ?? '') !== expectedPath) throw new Error('O path criptografado do documento não corresponde aos identificadores.');
  const result = {};
  for (const field of DOCUMENT_FIELDS) {
    if (document[field] !== undefined) result[field] = document[field];
  }
  return result;
}

export function confidentialCacheKey({ workspaceId, inspectionId, fileId }) {
  return `${uuid(workspaceId, 'workspaceId')}:${uuid(inspectionId, 'inspectionId')}:${uuid(fileId, 'fileId')}`;
}

export function confidentialInspectionScope({ workspaceId, inspectionId }) {
  return `${uuid(workspaceId, 'workspaceId')}:${uuid(inspectionId, 'inspectionId')}`;
}

export function assertDipdfCiphertext(value) {
  const bytes = asBytes(value, 'DIPDF1');
  if (bytes.byteLength < MAGIC.byteLength + 4) throw new Error('Container DIPDF1 truncado.');
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index]) throw new Error('Formato DIPDF1 inválido.');
  }
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset + MAGIC.byteLength, 4).getUint32(0, false);
  const headerStart = MAGIC.byteLength + 4;
  const headerEnd = headerStart + headerLength;
  if (headerLength < 2 || headerEnd > bytes.byteLength) throw new Error('Cabeçalho DIPDF1 inválido.');
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, headerEnd)));
  } catch {
    throw new Error('Cabeçalho DIPDF1 corrompido.');
  }
  if (header?.version !== VERSION || !Array.isArray(header?.chunks) || !header.chunks.length) {
    throw new Error('Cabeçalho DIPDF1 incompatível.');
  }
  let offset = headerEnd;
  for (const chunk of header.chunks) {
    const length = Number(chunk?.length);
    if (!Number.isInteger(length) || length <= 16) throw new Error('Chunk DIPDF1 inválido.');
    offset += length;
    if (offset > bytes.byteLength) throw new Error('Container DIPDF1 truncado.');
  }
  if (offset !== bytes.byteLength) throw new Error('Container DIPDF1 contém bytes excedentes.');
  return bytes;
}

export function prepareConfidentialCacheRecord({ document, container, cachedAt = new Date().toISOString() }) {
  assertNoPlaintextFields({ document }, 'cache');
  const safeDocument = sanitizeDocument(document);
  const bytes = assertDipdfCiphertext(container);
  const workspaceId = uuid(safeDocument.workspace_id, 'workspaceId');
  const inspectionId = uuid(safeDocument.inspection_id, 'inspectionId');
  const fileId = uuid(safeDocument.id, 'fileId');
  return {
    cacheKey: confidentialCacheKey({ workspaceId, inspectionId, fileId }),
    inspectionScope: confidentialInspectionScope({ workspaceId, inspectionId }),
    workspaceId,
    inspectionId,
    fileId,
    objectPath: safeDocument.object_path,
    cryptoVersion: VERSION,
    workspaceKeyVersion: (() => {
      const value = Number(safeDocument.workspace_key_version);
      if (!Number.isInteger(value) || value < 1) throw new Error('workspaceKeyVersion inválido.');
      return value;
    })(),
    document: safeDocument,
    // ArrayBuffer is structured-clone compatible in WebKit IndexedDB. Keep
    // ciphertext binary and avoid Blob/File persistence incompatibilities.
    container: bytes.slice().buffer,
    cachedAt: String(cachedAt)
  };
}

function assertIndexedDb() {
  if (!globalThis.indexedDB) throw new Error('IndexedDB não está disponível para o cofre confidencial offline.');
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
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao persistir o ciphertext confidencial.'));
    transaction.onabort = () => reject(transaction.error || new Error('Persistência do ciphertext confidencial foi cancelada.'));
  });
}

function openVault() {
  assertIndexedDb();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'cacheKey' });
        store.createIndex('inspectionScope', 'inspectionScope', { unique: false });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Falha ao abrir o cofre de ciphertext confidencial.'));
    request.onblocked = () => reject(new Error('O cofre confidencial está bloqueado por outra aba.'));
  });
}

async function withStore(mode, operation) {
  const db = await openVault();
  try {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const value = await operation(store);
    await transactionDone(transaction);
    return value;
  } finally {
    db.close();
  }
}

export async function cacheConfidentialCiphertext(input) {
  const record = prepareConfidentialCacheRecord(input);
  await withStore('readwrite', store => requestDone(store.put(record), 'Falha ao armazenar o ciphertext confidencial.'));
  return { ...record, container: undefined };
}

async function hydrateRecord(record) {
  if (!record) return null;
  const container = record.container instanceof Blob
    ? new Uint8Array(await record.container.arrayBuffer())
    : asBytes(record.container, 'DIPDF1').slice();
  assertDipdfCiphertext(container);
  return { document: { ...record.document }, container, cachedAt: record.cachedAt };
}

export async function getCachedConfidentialCiphertext({ workspaceId, inspectionId, fileId }) {
  const cacheKey = confidentialCacheKey({ workspaceId, inspectionId, fileId });
  const record = await withStore('readonly', store => requestDone(store.get(cacheKey), 'Falha ao ler o ciphertext confidencial.'));
  return hydrateRecord(record);
}

export async function listCachedConfidentialDocuments({ workspaceId, inspectionId }) {
  const scope = confidentialInspectionScope({ workspaceId, inspectionId });
  const records = await withStore('readonly', store =>
    requestDone(store.index('inspectionScope').getAll(scope), 'Falha ao listar o cache confidencial.')
  );
  return records
    .map(record => ({ document: { ...record.document }, cachedAt: record.cachedAt }))
    .sort((a, b) => String(a.cachedAt).localeCompare(String(b.cachedAt)));
}

export async function deleteCachedConfidentialCiphertext({ workspaceId, inspectionId, fileId }) {
  const cacheKey = confidentialCacheKey({ workspaceId, inspectionId, fileId });
  await withStore('readwrite', store => requestDone(store.delete(cacheKey), 'Falha ao remover o ciphertext confidencial local.'));
}

export async function clearConfidentialWorkspaceCache(workspaceId) {
  const normalizedWorkspaceId = uuid(workspaceId, 'workspaceId');
  await withStore('readwrite', store => new Promise((resolve, reject) => {
    const request = store.index('workspaceId').openKeyCursor(IDBKeyRange.only(normalizedWorkspaceId));
    request.onerror = () => reject(request.error || new Error('Falha ao limpar o cache confidencial do workspace.'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  }));
}

export async function clearAllConfidentialCiphertext() {
  await withStore('readwrite', store => requestDone(store.clear(), 'Falha ao limpar o cofre confidencial.'));
}

export const CONFIDENTIAL_OFFLINE_DB_NAME = DB_NAME;
export const CONFIDENTIAL_OFFLINE_MIME = MIME;
