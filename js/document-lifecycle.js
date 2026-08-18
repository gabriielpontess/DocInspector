import { codeIdentity, normalize, normalizeCode, normalizeRevision } from './domain.js';

const MAX_DOCUMENT_AUDIT = 1000;
const MAX_DELETED_DOCUMENTS = 10000;

function clone(value) {
  return structuredClone(value);
}

function nowIso(at) {
  const value = at ? new Date(at) : new Date();
  if (!Number.isFinite(value.getTime())) throw new Error('Data de alteração inválida.');
  return value.toISOString();
}

function audit(inspection, event) {
  const current = Array.isArray(inspection.documentAudit) ? inspection.documentAudit : [];
  inspection.documentAudit = [...current, event].slice(-MAX_DOCUMENT_AUDIT);
}

function validateCodeChange(inspection, documentId, nextCode) {
  if (!nextCode) throw new Error('Informe um Código PW válido.');
  const nextIdentity = codeIdentity(nextCode);
  for (const other of inspection.documents || []) {
    if (other.id === documentId) continue;
    const otherCode = normalizeCode(other.code);
    if (otherCode === nextCode) throw new Error(`Já existe um documento com o Código PW ${nextCode}.`);
    if (nextIdentity && codeIdentity(otherCode) === nextIdentity) {
      throw new Error(`O Código PW ${nextCode} é ambíguo em relação a ${otherCode}. Diferencie os códigos antes de salvar.`);
    }
  }
}

export function updateDocumentMetadata(inspection, documentId, patch = {}, { actor = null, at = null } = {}) {
  if (!inspection || !Array.isArray(inspection.documents)) throw new Error('Inspeção inválida.');
  const document = inspection.documents.find(item => item.id === documentId);
  if (!document) throw new Error('Documento não encontrado.');

  const changedAt = nowIso(at);
  const before = {
    code: normalizeCode(document.code),
    description: normalize(document.description),
    status: normalize(document.status),
    expectedRevision: normalizeRevision(document.expectedRevision)
  };
  const after = {
    code: normalizeCode(Object.hasOwn(patch, 'code') ? patch.code : document.code),
    description: normalize(Object.hasOwn(patch, 'description') ? patch.description : document.description),
    status: normalize(Object.hasOwn(patch, 'status') ? patch.status : document.status),
    expectedRevision: normalizeRevision(Object.hasOwn(patch, 'expectedRevision') ? patch.expectedRevision : document.expectedRevision)
  };

  validateCodeChange(inspection, documentId, after.code);
  if (!after.description) throw new Error('Informe uma descrição para o documento.');

  const changes = Object.fromEntries(
    Object.keys(after)
      .filter(key => before[key] !== after[key])
      .map(key => [key, { from: before[key], to: after[key] }])
  );
  if (!Object.keys(changes).length) return document;

  document.code = after.code;
  document.description = after.description;
  document.status = after.status;
  document.expectedRevision = after.expectedRevision;
  document.sourceCode = normalizeCode(document.sourceCode) || before.code;
  document.updatedAt = changedAt;

  audit(inspection, {
    id: crypto.randomUUID(),
    action: 'document.updated',
    documentId: document.id,
    at: changedAt,
    actor: normalize(actor) || null,
    changes
  });

  return document;
}

export function deleteDocumentLogically(inspection, documentId, { actor = null, reason = '', at = null } = {}) {
  if (!inspection || !Array.isArray(inspection.documents)) throw new Error('Inspeção inválida.');
  const index = inspection.documents.findIndex(item => item.id === documentId);
  if (index < 0) throw new Error('Documento não encontrado.');
  if (inspection.documents.length <= 1) throw new Error('A inspeção precisa manter pelo menos um documento ativo.');

  const deletedAt = nowIso(at);
  const document = clone(inspection.documents[index]);
  inspection.documents.splice(index, 1);
  inspection.deletedDocumentIds = [...new Set([...(inspection.deletedDocumentIds || []), document.id])]
    .filter(Boolean)
    .slice(-MAX_DELETED_DOCUMENTS);

  const previousArchive = Array.isArray(inspection.deletedDocuments) ? inspection.deletedDocuments : [];
  const archive = previousArchive.filter(item => item?.document?.id !== document.id);
  archive.push({
    document,
    deletedAt,
    deletedBy: normalize(actor) || null,
    reason: normalize(reason) || null
  });
  inspection.deletedDocuments = archive.slice(-MAX_DELETED_DOCUMENTS);

  audit(inspection, {
    id: crypto.randomUUID(),
    action: 'document.deleted',
    documentId: document.id,
    at: deletedAt,
    actor: normalize(actor) || null,
    changes: {
      code: document.code,
      description: document.description,
      reason: normalize(reason) || null
    }
  });

  return document;
}

export function deletedDocumentIdentities(inspection) {
  const identities = new Set();
  for (const entry of inspection?.deletedDocuments || []) {
    const document = entry?.document;
    for (const value of [document?.sourceCode, document?.code]) {
      const identity = codeIdentity(value);
      if (identity) identities.add(identity);
    }
  }
  return identities;
}
