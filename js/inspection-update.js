import { codeIdentity, normalizeCode, recalculateDocument, RESULT } from './domain.js';
import { archiveDocumentDeletion } from './document-lifecycle.js';

function clone(value) {
  return structuredClone(value);
}

function isReviewed(document) {
  if (!document) return false;
  if ((document.fieldCopies || []).length > 0) return true;
  if (document.result && document.result !== RESULT.PENDING) return true;
  return Boolean(document.verifiedAt);
}

function pushUnique(map, key, document) {
  if (!key) return;
  const entries = map.get(key) || [];
  if (!entries.some(item => item.id === document.id)) entries.push(document);
  map.set(key, entries);
}

function indexExistingDocuments(documents = []) {
  const byCode = new Map();
  const byIdentity = new Map();

  for (const document of documents) {
    for (const value of [document.code, document.sourceCode]) {
      const code = normalizeCode(value);
      if (code) pushUnique(byCode, code, document);
      const identity = codeIdentity(code);
      if (identity) pushUnique(byIdentity, identity, document);
    }
  }

  return { byCode, byIdentity };
}

function findExistingDocument(incoming, index, consumedIds) {
  const exactCandidates = (index.byCode.get(normalizeCode(incoming.code)) || [])
    .filter(document => !consumedIds.has(document.id));
  if (exactCandidates.length) return exactCandidates[0];

  const identity = codeIdentity(incoming.code);
  const candidates = (index.byIdentity.get(identity) || []).filter(document => !consumedIds.has(document.id));
  return candidates.length === 1 ? candidates[0] : null;
}

function mergeAuthoritativeCatalog(existing, incoming) {
  const merged = clone(existing);
  const changed = normalizeCode(existing.code) !== normalizeCode(incoming.code)
    || String(existing.description || '') !== String(incoming.description || '')
    || String(existing.status || '') !== String(incoming.status || '')
    || String(existing.expectedRevision || '') !== String(incoming.expectedRevision || '');

  // A planilha substituta é a fonte autoritativa para os campos de catálogo.
  // O conteúdo operacional continua vindo do documento existente: UUID, cópias,
  // evidências, comentários, resultado, auditoria e demais dados de campo.
  merged.code = incoming.code;
  merged.description = incoming.description;
  merged.status = incoming.status;
  merged.expectedRevision = incoming.expectedRevision;
  merged.sourceCode = normalizeCode(incoming.code);
  if (changed) merged.updatedAt = new Date().toISOString();
  return recalculateDocument(merged);
}

/**
 * Substitui o catálogo ativo pela nova planilha sem destruir o trabalho de campo.
 *
 * Regras:
 * - a nova lista é autoritativa, independentemente de conter mais ou menos PWs;
 * - PW correspondente: mantém UUID, cópias, fotos, comentários e histórico, mas
 *   Código/descrição/status/revisão esperada passam a refletir a nova lista;
 * - PW novo: entra como novo documento pendente;
 * - PW ausente da nova lista: sai do catálogo ativo e é arquivado com tombstone,
 *   inclusive quando já foi revisado, permitindo auditoria e restauração posterior;
 * - um PW anteriormente excluído pode voltar se reaparecer numa lista futura,
 *   como nova geração/UUID, sem remover o tombstone histórico anterior;
 * - updatedAt da inspeção não é forçado aqui; saveInspection controla o token de
 *   concorrência no momento da persistência.
 */
export function buildInspectionListUpdate(existingInspection, incomingDocuments, {
  actor = null,
  at = null
} = {}) {
  if (!existingInspection || !Array.isArray(existingInspection.documents)) {
    throw new Error('A inspeção atual é inválida.');
  }
  if (!Array.isArray(incomingDocuments) || !incomingDocuments.length) {
    throw new Error('A nova lista não possui documentos válidos.');
  }

  const inspection = clone(existingInspection);
  const existingDocuments = inspection.documents;
  const index = indexExistingDocuments(existingDocuments);
  const consumedIds = new Set();
  const nextDocuments = [];
  const summary = {
    previousTotal: existingDocuments.length,
    incomingTotal: incomingDocuments.length,
    matched: 0,
    catalogChanged: 0,
    reviewedPreserved: 0,
    added: 0,
    removed: 0,
    pendingRemoved: 0,
    reviewedRemoved: 0
  };

  for (const incoming of incomingDocuments) {
    const existing = findExistingDocument(incoming, index, consumedIds);
    if (!existing) {
      nextDocuments.push(clone(incoming));
      summary.added += 1;
      continue;
    }

    consumedIds.add(existing.id);
    summary.matched += 1;
    if (isReviewed(existing)) summary.reviewedPreserved += 1;

    const merged = mergeAuthoritativeCatalog(existing, incoming);
    const changed = normalizeCode(existing.code) !== normalizeCode(merged.code)
      || String(existing.description || '') !== String(merged.description || '')
      || String(existing.status || '') !== String(merged.status || '')
      || String(existing.expectedRevision || '') !== String(merged.expectedRevision || '');
    if (changed) summary.catalogChanged += 1;

    nextDocuments.push(merged);
  }

  for (const existing of existingDocuments) {
    if (consumedIds.has(existing.id)) continue;
    archiveDocumentDeletion(inspection, existing, {
      actor,
      at,
      source: 'inspection-list-replacement',
      reason: 'Removido pela substituição da lista de inspeção.'
    });
    summary.removed += 1;
    if (isReviewed(existing)) summary.reviewedRemoved += 1;
    else summary.pendingRemoved += 1;
  }

  inspection.documents = nextDocuments;

  return {
    inspection,
    summary: {
      ...summary,
      finalTotal: nextDocuments.length
    }
  };
}

export function inspectionUpdateHasRisk(summary) {
  return Boolean(summary?.removed || summary?.catalogChanged);
}
