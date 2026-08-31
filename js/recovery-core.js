import { codeIdentity, createId, normalizeCode } from './domain.js';

const MAX_DOCUMENT_AUDIT = 1000;

function clone(value) {
  return structuredClone(value);
}

function nowIso(at) {
  const value = at ? new Date(at) : new Date();
  if (!Number.isFinite(value.getTime())) throw new Error('Data de recuperação inválida.');
  return value.toISOString();
}

export function restoredArchiveIds(inspection) {
  const restored = new Set();
  for (const event of inspection?.documentAudit || []) {
    if (event?.action !== 'document.restored') continue;
    const archivedId = String(event?.changes?.restoredFromDocumentId || '').trim();
    if (archivedId) restored.add(archivedId);
  }
  return restored;
}

export function listRestorableDeletedDocuments(inspection) {
  const alreadyRestored = restoredArchiveIds(inspection);
  const activeIdentities = new Set(
    (inspection?.documents || [])
      .map(document => codeIdentity(document?.code))
      .filter(Boolean)
  );
  return (inspection?.deletedDocuments || [])
    .filter(entry => {
      const archivedId = entry?.document?.id;
      const identity = codeIdentity(entry?.document?.code);
      return archivedId
        && !alreadyRestored.has(archivedId)
        && (!identity || !activeIdentities.has(identity));
    })
    .map(entry => clone(entry));
}

function assertNoActiveCodeConflict(inspection, archivedDocument) {
  const code = normalizeCode(archivedDocument?.code);
  const identity = codeIdentity(code);
  if (!code) throw new Error('O documento arquivado não possui Código PW válido.');
  for (const active of inspection.documents || []) {
    const activeCode = normalizeCode(active?.code);
    if (activeCode === code) throw new Error(`Já existe um documento ativo com o Código PW ${code}.`);
    if (identity && codeIdentity(activeCode) === identity) {
      throw new Error(`O Código PW ${code} é ambíguo em relação ao documento ativo ${activeCode}.`);
    }
  }
}

/**
 * Restaura o conteúdo arquivado como uma nova geração interna.
 *
 * O UUID tombstonado permanece em deletedDocumentIds para que aparelhos antigos
 * não possam ressuscitar/apagar a geração anterior durante o merge. O snapshot
 * arquivado também permanece em deletedDocuments como trilha histórica, mas deixa
 * de ser oferecido como restaurável. O chamador deve relincar referências externas
 * (PDFs confidenciais) do UUID antigo para o novo UUID antes de persistir a inspeção.
 */
export function buildRestoredDocumentGeneration(inspection, archivedDocumentId, {
  newDocumentId = null,
  actor = null,
  at = null
} = {}) {
  if (!inspection || !Array.isArray(inspection.documents) || !Array.isArray(inspection.deletedDocuments)) {
    throw new Error('Inspeção inválida para recuperação.');
  }
  const archivedId = String(archivedDocumentId || '').trim();
  if (!archivedId) throw new Error('Documento arquivado inválido.');
  if (restoredArchiveIds(inspection).has(archivedId)) throw new Error('Este documento já foi restaurado anteriormente.');

  const entry = inspection.deletedDocuments.find(item => item?.document?.id === archivedId);
  if (!entry?.document) throw new Error('Documento excluído não encontrado na lixeira da inspeção.');
  assertNoActiveCodeConflict(inspection, entry.document);

  const restoredAt = nowIso(at);
  const restored = clone(entry.document);
  restored.id = String(newDocumentId || createId());
  restored.updatedAt = restoredAt;

  const next = clone(inspection);
  next.documents = [...(next.documents || []), restored];
  next.deletedDocumentIds = [...new Set([...(next.deletedDocumentIds || []), archivedId])];
  next.deletedDocuments = [...(next.deletedDocuments || [])];
  next.documentAudit = [...(next.documentAudit || []), {
    id: createId(),
    action: 'document.restored',
    documentId: restored.id,
    at: restoredAt,
    actor: String(actor || '').trim() || null,
    changes: {
      restoredFromDocumentId: archivedId,
      code: restored.code,
      description: restored.description
    }
  }].slice(-MAX_DOCUMENT_AUDIT);

  return {
    inspection: next,
    restoredDocument: restored,
    archivedDocumentId: archivedId,
    restoredAt
  };
}

export function buildPdfSoftDeletePatch(at = null) {
  return {
    status: 'DELETED',
    deleted_at: nowIso(at)
  };
}

export function buildPdfRestorePatch() {
  return {
    status: 'ACTIVE',
    deleted_at: null
  };
}

export function splitConfidentialObjectPath(objectPath) {
  const normalized = String(objectPath || '').trim().replace(/^\/+|\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('Path do PDF confidencial inválido.');
  const filename = parts.pop();
  return { folder: parts.join('/'), filename };
}
