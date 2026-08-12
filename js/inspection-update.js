import { codeIdentity, normalizeCode, recalculateDocument, RESULT } from './domain.js';

function clone(value) {
  return structuredClone(value);
}

function isReviewed(document) {
  if (!document) return false;
  if ((document.fieldCopies || []).length > 0) return true;
  if (document.result && document.result !== RESULT.PENDING) return true;
  return Boolean(document.verifiedAt);
}

function indexExistingDocuments(documents = []) {
  const byCode = new Map();
  const byIdentity = new Map();

  for (const document of documents) {
    const code = normalizeCode(document.code);
    if (code) byCode.set(code, document);

    const identity = codeIdentity(document.code);
    if (!identity) continue;
    const entries = byIdentity.get(identity) || [];
    entries.push(document);
    byIdentity.set(identity, entries);
  }

  return { byCode, byIdentity };
}

function findExistingDocument(incoming, index, consumedIds) {
  const exact = index.byCode.get(normalizeCode(incoming.code));
  if (exact && !consumedIds.has(exact.id)) return exact;

  const identity = codeIdentity(incoming.code);
  const candidates = (index.byIdentity.get(identity) || []).filter(document => !consumedIds.has(document.id));
  return candidates.length === 1 ? candidates[0] : null;
}

function mergeCatalogFields(existing, incoming) {
  const merged = clone(existing);
  merged.code = incoming.code;
  merged.description = incoming.description;
  merged.status = incoming.status;
  merged.expectedRevision = incoming.expectedRevision;
  return recalculateDocument(merged);
}

/**
 * Rebuild an inspection from a newly imported catalog without destroying field work.
 *
 * Rules:
 * - Same PW: preserve the existing document id, copies, evidence, comments and timestamps;
 *   only catalog-owned fields (code/description/status/expected revision) come from the new list.
 * - New PW: add it as pending using the freshly imported document.
 * - PW removed from the new list: remove it only when it is still pending/unreviewed.
 * - Reviewed PW removed from the new list: retain it conservatively so field evidence is never
 *   discarded by a spreadsheet refresh.
 * - Keep the inspection updatedAt token unchanged. saveInspection owns the timestamp update and
 *   uses the incoming token to detect concurrent writes safely.
 */
export function buildInspectionListUpdate(existingInspection, incomingDocuments) {
  if (!existingInspection || !Array.isArray(existingInspection.documents)) {
    throw new Error('A inspeção atual é inválida.');
  }
  if (!Array.isArray(incomingDocuments) || !incomingDocuments.length) {
    throw new Error('A nova lista não possui documentos válidos.');
  }

  const existingDocuments = existingInspection.documents;
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
    pendingRemoved: 0,
    reviewedRetained: 0
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

    const changed = normalizeCode(existing.code) !== normalizeCode(incoming.code)
      || String(existing.description || '') !== String(incoming.description || '')
      || String(existing.status || '') !== String(incoming.status || '')
      || String(existing.expectedRevision || '') !== String(incoming.expectedRevision || '');
    if (changed) summary.catalogChanged += 1;

    nextDocuments.push(mergeCatalogFields(existing, incoming));
  }

  for (const existing of existingDocuments) {
    if (consumedIds.has(existing.id)) continue;
    if (isReviewed(existing)) {
      nextDocuments.push(clone(existing));
      summary.reviewedRetained += 1;
    } else {
      summary.pendingRemoved += 1;
    }
  }

  const inspection = {
    ...clone(existingInspection),
    documents: nextDocuments
  };

  return {
    inspection,
    summary: {
      ...summary,
      finalTotal: nextDocuments.length
    }
  };
}

export function inspectionUpdateHasRisk(summary) {
  return Boolean(summary?.reviewedRetained || summary?.catalogChanged);
}
