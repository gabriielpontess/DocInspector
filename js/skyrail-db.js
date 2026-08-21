import { normalizeSkyrailDocument, sortSkyrailDocuments } from './skyrail-model.js';

const DB_NAME = 'byd-skyrail-v1';
const DB_VERSION = 1;
const DOCUMENTS_STORE = 'documents';

function assertIndexedDB() {
  if (!('indexedDB' in globalThis)) {
    throw new Error('Este aparelho não oferece o armazenamento offline necessário para o BYD Skyrail.');
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao acessar os documentos offline.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao salvar os documentos offline.'));
    transaction.onabort = () => reject(transaction.error || new Error('Operação offline cancelada.'));
  });
}

function openDB() {
  assertIndexedDB();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Falha ao abrir a biblioteca offline do BYD Skyrail.'));
    request.onblocked = () => reject(new Error('A biblioteca offline está sendo usada por outra aba. Feche as outras abas e tente novamente.'));
  });
}

async function withStore(mode, operation) {
  const db = await openDB();
  try {
    const transaction = db.transaction(DOCUMENTS_STORE, mode);
    const store = transaction.objectStore(DOCUMENTS_STORE);
    const result = await operation(store, transaction);
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

export async function listCachedSkyrailDocuments(workspaceId) {
  const normalizedWorkspaceId = String(workspaceId ?? '').trim();
  if (!normalizedWorkspaceId) return [];
  const records = await withStore('readonly', store => requestToPromise(store.getAll()));
  return sortSkyrailDocuments(records
    .map(normalizeSkyrailDocument)
    .filter(document => document?.workspace_id === normalizedWorkspaceId));
}

export async function getCachedSkyrailDocument(documentId) {
  const id = String(documentId ?? '').trim();
  if (!id) return null;
  const record = await withStore('readonly', store => requestToPromise(store.get(id)));
  return normalizeSkyrailDocument(record);
}

export async function putCachedSkyrailDocument(document) {
  const normalized = normalizeSkyrailDocument(document);
  if (!normalized) throw new Error('Documento inválido para armazenamento offline.');
  await withStore('readwrite', store => requestToPromise(store.put(normalized)));
  return normalized;
}

export async function deleteCachedSkyrailDocument(documentId) {
  const id = String(documentId ?? '').trim();
  if (!id) return;
  await withStore('readwrite', store => requestToPromise(store.delete(id)));
}

export async function removeCachedSkyrailDocumentsNotIn(workspaceId, allowedIds = []) {
  const normalizedWorkspaceId = String(workspaceId ?? '').trim();
  const allowed = new Set(allowedIds.map(value => String(value ?? '').trim()).filter(Boolean));
  const db = await openDB();

  try {
    const transaction = db.transaction(DOCUMENTS_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(DOCUMENTS_STORE);
    const allRequest = store.getAll();

    allRequest.onsuccess = () => {
      for (const record of allRequest.result || []) {
        if (String(record?.workspace_id ?? '').trim() === normalizedWorkspaceId && !allowed.has(String(record?.id ?? '').trim())) {
          store.delete(record.id);
        }
      }
    };

    await done;
  } finally {
    db.close();
  }
}
