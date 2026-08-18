import { codeIdentity, normalizeCode, recalculateDocument, RESULT } from './domain.js';
import { deletedDocumentIdentities } from './document-lifecycle.js';

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
  if (exactCandidates.length === 1) return exactCandidates[0];

  const identity = codeIdentity(incoming.code);
  const candidates = (index.byIdentity.get(identity) || []).filter(document => !consumedIds.has(document.id));
  return candidates.length === 1 ? candidates[0] : null;
}

function manualFieldsForDocument(inspection, documentId) {
  const fields = new Set();
  for (const event of inspection.documentAudit || []) {
    if (event?.action !== 'document.updated' || event.documentId !== documentId) continue;
    for (const key of Object.keys(event.changes || {})) fields.add(key);
  }
  return fields;
}

function mergeCatalogFields(existing, incoming, manualFields) {
  const merged = clone(existing);
  const next = {
    code: manualFields.has('code') ? existing.code : incoming.code,
    description: manualFields.has('description') ? existing.description : incoming.description,
    status: manualFields.has('status') ? existing.status : incoming.status,
    expectedRevision: manualFields.has('expectedRevision') ? existing.expectedRevision : incoming.expectedRevision
  };
  const changed = normalizeCode(existing.code) !== normalizeCode(next.code)
    || String(existing.description || '') !== String(next.description || '')
    || String(existing.status || '') !== String(next.status || '')
    || String(existing.expectedRevision || '') !== String(next.expectedRevision || '');

  merged.code = next.code;
  merged.description = next.description;
  merged.status = next.status;
  merged.expectedRevision = next.expectedRevision;
  merged.sourceCode = manualFields.has('code')
    ? (normalizeCode(existing.sourceCode) || normalizeCode(incoming.code))
    : normalizeCode(incoming.code);
  if (changed) merged.updatedAt = new Date().toISOString();
  return recalculateDocument(merged);
}

/**
 * Rebuild an inspection from a newly imported catalog without destroying field work.
 *
 * Rules:
 * - Same/source PW: preserve the existing document id, copies, evidence, comments and timestamps;
 * - manually edited catalog fields remain authoritative across a spreadsheet refresh;
 * - manually deleted documents are skipped when the spreadsheet contains the same PW again;
 * - new PW: add it as pending using the freshly imported document;
 * - PW removed from the new list: remove it only when it is still pending/unreviewed;
 * - reviewed PW removed from the new list: retain it conservatively so field evidence is never discarded;
 * - keep the inspection updatedAt token unchanged. saveInspection owns the optimistic-concurrency token.
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
  const deletedIdentities = deletedDocumentIdentities(existingInspection);
  const consumedIds = new Set();
  const nextDocuments = [];
  const summary = {
    previousTotal: existingDocuments.length,
    incomingTotal: incomingDocuments.length,
    matched: 0,
    catalogChanged: 0,
    reviewedPreserved: 0,
    added: 0,
    tombstonedSkipped: 0,
    pendingRemoved: 0,
    reviewedRetained: 0
  };

  for (const incoming of incomingDocuments) {
    const existing = findExistingDocument(incoming, index, consumedIds);
    if (!existing) {
      const incomingIdentity = codeIdentity(incoming.code);
      if (incomingIdentity && deletedIdentities.has(incomingIdentity)) {
        summary.tombstonedSkipped += 1;
        continue;
      }
      nextDocuments.push(clone(incoming));
      summary.added += 1;
      continue;
    }

    consumedIds.add(existing.id);
    summary.matched += 1;
    if (isReviewed(existing)) summary.reviewedPreserved += 1;

    const manualFields = manualFieldsForDocument(existingInspection, existing.id);
    const merged = mergeCatalogFields(existing, incoming, manualFields);
    const changed = normalizeCode(existing.code) !== normalizeCode(merged.code)
      || String(existing.description || '') !== String(merged.description || '')
      || String(existing.status || '') !== String(merged.status || '')
      || String(existing.expectedRevision || '') !== String(merged.expectedRevision || '');
    if (changed) summary.catalogChanged += 1;

    nextDocuments.push(merged);
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
  return Boolean(summary?.reviewedRetained || summary?.catalogChanged || summary?.tombstonedSkipped);
}
