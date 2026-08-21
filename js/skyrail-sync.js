import {
  deleteCachedSkyrailDocument,
  getCachedSkyrailDocument,
  listCachedSkyrailDocuments,
  putCachedSkyrailDocument,
  removeCachedSkyrailDocumentsNotIn
} from './skyrail-db.js';
import { downloadSkyrailPdf, listActiveSkyrailDocuments } from './skyrail-api.js';
import { documentNeedsDownload, normalizeSkyrailDocument } from './skyrail-model.js';

const LAST_SYNC_PREFIX = 'byd-skyrail-last-sync-v1:';

function workspaceKey(workspaceId) {
  return `${LAST_SYNC_PREFIX}${String(workspaceId ?? '').trim()}`;
}

export function getSkyrailLastSync(workspaceId) {
  try {
    return localStorage.getItem(workspaceKey(workspaceId)) || '';
  } catch {
    return '';
  }
}

function setSkyrailLastSync(workspaceId, timestamp) {
  try {
    localStorage.setItem(workspaceKey(workspaceId), timestamp);
  } catch {
    // A sincronização continua válida mesmo se o navegador bloquear localStorage.
  }
}

function assertOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Sem conexão com a internet para sincronizar agora.');
  }
}

export async function isReadableSkyrailPdfBlob(blob) {
  if (!(blob instanceof Blob) || blob.size < 5) return false;
  try {
    const prefix = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    return new TextDecoder().decode(prefix) === '%PDF-';
  } catch {
    return false;
  }
}

export async function cacheSingleSkyrailDocument(document) {
  assertOnline();
  const remote = normalizeSkyrailDocument(document);
  if (!remote) throw new Error('Documento inválido para download.');
  const blob = await downloadSkyrailPdf(remote.file_path);
  return putCachedSkyrailDocument({
    ...remote,
    blob,
    downloaded_at: new Date().toISOString()
  });
}

export async function syncSkyrailDocuments(workspaceId, { onProgress = null } = {}) {
  assertOnline();
  const id = String(workspaceId ?? '').trim();
  if (!id) throw new Error('Workspace inválido para sincronização.');

  const remoteDocuments = await listActiveSkyrailDocuments(id);
  const localDocuments = await listCachedSkyrailDocuments(id);
  const localById = new Map(localDocuments.map(document => [document.id, document]));
  let downloaded = 0;
  let reused = 0;

  for (let index = 0; index < remoteDocuments.length; index += 1) {
    const remote = remoteDocuments[index];
    const local = localById.get(remote.id) || null;
    onProgress?.({
      current: index + 1,
      total: remoteDocuments.length,
      code: remote.code,
      phase: 'document'
    });

    const readableLocalPdf = await isReadableSkyrailPdfBlob(local?.blob);
    if (documentNeedsDownload(local, remote) || !readableLocalPdf) {
      const blob = await downloadSkyrailPdf(remote.file_path);
      await putCachedSkyrailDocument({
        ...remote,
        blob,
        downloaded_at: new Date().toISOString()
      });
      downloaded += 1;
      continue;
    }

    // Não regrave o mesmo Blob no IndexedDB. Em WebKit/Safari isso pode
    // invalidar a referência de um Blob já persistido e causar NotFoundError.
    reused += 1;
  }

  await removeCachedSkyrailDocumentsNotIn(id, remoteDocuments.map(document => document.id));
  const completedAt = new Date().toISOString();
  setSkyrailLastSync(id, completedAt);
  onProgress?.({ current: remoteDocuments.length, total: remoteDocuments.length, phase: 'complete' });

  return {
    completedAt,
    total: remoteDocuments.length,
    downloaded,
    reused
  };
}

export async function ensureSkyrailDocumentOffline(documentId) {
  const cached = await getCachedSkyrailDocument(documentId);
  if (!cached) throw new Error('Documento não encontrado na biblioteca local.');
  if (await isReadableSkyrailPdfBlob(cached.blob)) return cached;
  return cacheSingleSkyrailDocument(cached);
}

export async function removeSkyrailDocumentOffline(documentId) {
  await deleteCachedSkyrailDocument(documentId);
}
