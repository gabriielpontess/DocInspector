import { hydrateInspection } from './domain.js';

const DB_NAME = 'sky17gold-db';
const DB_VERSION = 3;
const INSPECTIONS_STORE = 'inspections';
const META_STORE = 'sync-meta';
const EVIDENCE_STORE = 'evidence';

const PENDING_INSPECTION_DELETIONS_KEY = 'pending-deletions';
const PENDING_EVIDENCE_DELETIONS_KEY = 'pending-evidence-deletions';

function assertIndexedDB() {
  if (!('indexedDB' in globalThis)) {
    throw new Error('Este navegador não oferece suporte ao armazenamento local necessário.');
  }
}

function openDB() {
  assertIndexedDB();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INSPECTIONS_STORE)) {
        db.createObjectStore(INSPECTIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(EVIDENCE_STORE)) {
        db.createObjectStore(EVIDENCE_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Falha ao abrir o banco local.'));
    request.onblocked = () => reject(new Error('O banco local está bloqueado por outra aba do DocInspector. Feche as outras abas e tente novamente.'));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao acessar os dados locais.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao salvar os dados locais.'));
    transaction.onabort = () => reject(transaction.error || new Error('Operação local cancelada.'));
  });
}

async function withStore(storeName, mode, operation) {
  const db = await openDB();
  try {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = await operation(store, transaction);
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

export async function listInspections() {
  const result = await withStore(INSPECTIONS_STORE, 'readonly', store => requestToPromise(store.getAll()));
  return result
    .map(hydrateInspection)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getInspection(id) {
  if (!id) return null;
  const result = await withStore(INSPECTIONS_STORE, 'readonly', store => requestToPromise(store.get(id)));
  return hydrateInspection(result);
}

function concurrentModificationError() {
  const error = new Error('Esta inspeção foi alterada em outra aba ou aparelho enquanto você trabalhava. A gravação foi interrompida para evitar sobrescrever dados mais recentes.');
  error.code = 'CONCURRENT_MODIFICATION';
  return error;
}

export async function saveInspection(inspection, { touch = true, checkConflict = touch } = {}) {
  if (!inspection?.id) throw new Error('Não foi possível salvar uma inspeção sem identificador.');

  const nextUpdatedAt = touch ? new Date().toISOString() : inspection.updatedAt;
  const record = { ...inspection, updatedAt: nextUpdatedAt };
  const db = await openDB();
  let conflict = null;

  try {
    const tx = db.transaction(INSPECTIONS_STORE, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(INSPECTIONS_STORE);

    const operation = new Promise((resolve, reject) => {
      const getRequest = store.get(inspection.id);
      getRequest.onerror = () => reject(getRequest.error || new Error('Falha ao conferir a versão local da inspeção.'));
      getRequest.onsuccess = () => {
        const current = getRequest.result;
        if (checkConflict && current?.updatedAt && inspection.updatedAt && current.updatedAt !== inspection.updatedAt) {
          conflict = concurrentModificationError();
          tx.abort();
          reject(conflict);
          return;
        }

        const putRequest = store.put(record);
        putRequest.onerror = () => reject(putRequest.error || new Error('Falha ao salvar a inspeção.'));
        putRequest.onsuccess = () => resolve();
      };
    });

    await Promise.all([operation, done]);
    if (touch) inspection.updatedAt = nextUpdatedAt;
    return inspection;
  } catch (error) {
    throw conflict || error;
  } finally {
    db.close();
  }
}

export async function deleteInspection(id) {
  if (!id) return;
  await withStore(INSPECTIONS_STORE, 'readwrite', store => requestToPromise(store.delete(id)));
}

/**
 * Remove uma inspeção e suas evidências locais em uma única transação IndexedDB.
 * Quando a sincronização está ativa, os tombstones remotos também são enfileirados
 * na mesma transação, evitando o estado perigoso "remoto marcado para exclusão,
 * mas inspeção local ainda existente" caso uma gravação intermediária falhe.
 */
export async function deleteInspectionBundle(id, {
  syncEnabled = false,
  evidencePaths = [],
  evidenceIds = []
} = {}) {
  if (!id) return;

  const uniquePaths = [...new Set(evidencePaths.filter(Boolean))];
  const uniqueEvidenceIds = [...new Set(evidenceIds.filter(Boolean))];
  const db = await openDB();

  try {
    const tx = db.transaction([INSPECTIONS_STORE, META_STORE, EVIDENCE_STORE], 'readwrite');
    const inspections = tx.objectStore(INSPECTIONS_STORE);
    const meta = tx.objectStore(META_STORE);
    const evidence = tx.objectStore(EVIDENCE_STORE);

    inspections.delete(id);
    for (const evidenceId of uniqueEvidenceIds) evidence.delete(evidenceId);

    if (syncEnabled) {
      const inspectionQueueRequest = meta.get(PENDING_INSPECTION_DELETIONS_KEY);
      inspectionQueueRequest.onsuccess = () => {
        const pending = new Set(inspectionQueueRequest.result?.value || []);
        pending.add(id);
        meta.put({ key: PENDING_INSPECTION_DELETIONS_KEY, value: [...pending] });
      };

      if (uniquePaths.length) {
        const evidenceQueueRequest = meta.get(PENDING_EVIDENCE_DELETIONS_KEY);
        evidenceQueueRequest.onsuccess = () => {
          const pending = new Set(evidenceQueueRequest.result?.value || []);
          for (const path of uniquePaths) pending.add(path);
          meta.put({ key: PENDING_EVIDENCE_DELETIONS_KEY, value: [...pending] });
        };
      }
    }

    await transactionDone(tx);
  } finally {
    db.close();
  }
}

/**
 * Persiste a remoção de uma cópia e a higiene de sua evidência na mesma
 * transação local. Assim, o documento, a fila de exclusão remota e o blob
 * local nunca ficam em estados intermediários divergentes.
 */
export async function saveInspectionWithEvidenceDeletion(inspection, {
  syncEnabled = false,
  evidencePath = '',
  evidenceId = ''
} = {}) {
  if (!inspection?.id) throw new Error('Não foi possível salvar uma inspeção sem identificador.');

  const nextUpdatedAt = new Date().toISOString();
  const record = { ...inspection, updatedAt: nextUpdatedAt };
  const normalizedPath = String(evidencePath || '').trim();
  const normalizedEvidenceId = String(evidenceId || '').trim();
  const db = await openDB();
  let conflict = null;

  try {
    const tx = db.transaction([INSPECTIONS_STORE, META_STORE, EVIDENCE_STORE], 'readwrite');
    const done = transactionDone(tx);
    const inspections = tx.objectStore(INSPECTIONS_STORE);
    const meta = tx.objectStore(META_STORE);
    const evidence = tx.objectStore(EVIDENCE_STORE);

    const operation = new Promise((resolve, reject) => {
      const currentRequest = inspections.get(inspection.id);
      currentRequest.onerror = () => reject(currentRequest.error || new Error('Falha ao conferir a versão local da inspeção.'));
      currentRequest.onsuccess = () => {
        const current = currentRequest.result;
        if (current?.updatedAt && inspection.updatedAt && current.updatedAt !== inspection.updatedAt) {
          conflict = concurrentModificationError();
          tx.abort();
          reject(conflict);
          return;
        }

        inspections.put(record);
        if (normalizedEvidenceId) evidence.delete(normalizedEvidenceId);

        if (syncEnabled && normalizedPath) {
          const queueRequest = meta.get(PENDING_EVIDENCE_DELETIONS_KEY);
          queueRequest.onerror = () => reject(queueRequest.error || new Error('Falha ao atualizar a fila de exclusão de evidências.'));
          queueRequest.onsuccess = () => {
            const pending = new Set(queueRequest.result?.value || []);
            pending.add(normalizedPath);
            meta.put({ key: PENDING_EVIDENCE_DELETIONS_KEY, value: [...pending] });
            resolve();
          };
        } else {
          resolve();
        }
      };
    });

    await Promise.all([operation, done]);
    inspection.updatedAt = nextUpdatedAt;
    return inspection;
  } catch (error) {
    throw conflict || error;
  } finally {
    db.close();
  }
}
export async function replaceAllInspections(inspections) {
  if (!Array.isArray(inspections)) throw new Error('Conjunto de inspeções inválido.');

  await withStore(INSPECTIONS_STORE, 'readwrite', store => {
    store.clear();
    for (const inspection of inspections.map(hydrateInspection).filter(Boolean)) {
      store.put(inspection);
    }
    return Promise.resolve();
  });
}

export async function getSyncMeta(key, fallback = null) {
  const result = await withStore(META_STORE, 'readonly', store => requestToPromise(store.get(key)));
  return result?.value ?? fallback;
}

export async function setSyncMeta(key, value) {
  await withStore(META_STORE, 'readwrite', store => requestToPromise(store.put({ key, value })));
  return value;
}

export async function deleteSyncMeta(key) {
  await withStore(META_STORE, 'readwrite', store => requestToPromise(store.delete(key)));
}


export async function saveEvidence(evidence) {
  if (!evidence?.id || !(evidence.blob instanceof Blob)) {
    throw new Error('Evidência fotográfica inválida.');
  }
  const record = {
    id: evidence.id,
    blob: evidence.blob,
    type: evidence.blob.type || 'image/jpeg',
    name: evidence.name || 'evidencia.jpg',
    createdAt: evidence.createdAt || new Date().toISOString()
  };
  await withStore(EVIDENCE_STORE, 'readwrite', store => requestToPromise(store.put(record)));
  return record;
}

export async function listEvidence() {
  return withStore(EVIDENCE_STORE, 'readonly', store => requestToPromise(store.getAll()));
}

export async function updateEvidence(id, patch = {}) {
  if (!id) throw new Error('Identificador da evidência inválido.');
  return withStore(EVIDENCE_STORE, 'readwrite', store => new Promise((resolve, reject) => {
    const getRequest = store.get(id);
    getRequest.onerror = () => reject(getRequest.error || new Error('Falha ao localizar a evidência local.'));
    getRequest.onsuccess = () => {
      const current = getRequest.result;
      if (!current) {
        resolve(null);
        return;
      }
      const next = { ...current, ...patch, id: current.id };
      const putRequest = store.put(next);
      putRequest.onerror = () => reject(putRequest.error || new Error('Falha ao atualizar a evidência local.'));
      putRequest.onsuccess = () => resolve(next);
    };
  }));
}

export async function getEvidence(id) {
  if (!id) return null;
  return withStore(EVIDENCE_STORE, 'readonly', store => requestToPromise(store.get(id)));
}

export async function deleteEvidence(id) {
  if (!id) return;
  await withStore(EVIDENCE_STORE, 'readwrite', store => requestToPromise(store.delete(id)));
}
