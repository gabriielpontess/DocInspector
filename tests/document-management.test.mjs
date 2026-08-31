import assert from 'node:assert/strict';
import {
  addFieldCopy,
  createInspection,
  hydrateInspection,
  makeDocument
} from '../js/domain.js';
import {
  deleteDocumentLogically,
  inspectionEvidenceDocuments,
  updateDocumentMetadata
} from '../js/document-lifecycle.js';
import { buildInspectionListUpdate } from '../js/inspection-update.js';
import { mergeInspection } from '../js/sync.js';

function document(row, id, at = '2026-08-18T10:00:00.000Z') {
  const item = makeDocument(row);
  item.id = id;
  item.createdAt = at;
  item.updatedAt = at;
  return item;
}

const inspection = createInspection({ project: 'Linha 17', system: 'AMV', responsible: 'Equipe', location: 'Campo' });
inspection.id = 'inspection-1';
inspection.createdAt = '2026-08-18T09:00:00.000Z';
inspection.updatedAt = '2026-08-18T10:00:00.000Z';

const editable = document({ code: 'PW-001', description: 'Documento A', status: 'Ativo', expectedRevision: 'A' }, 'doc-a');
const removable = document({ code: 'PW-002', description: 'Documento B', status: 'Ativo', expectedRevision: 'B' }, 'doc-b');
addFieldCopy(editable, {
  id: 'copy-a1',
  foundRevision: 'A',
  comment: 'cópia conferida',
  evidenceId: 'evidence-a1',
  evidencePath: 'workspace/inspection-1/doc-a/copy-a1.jpg'
});
addFieldCopy(removable, {
  id: 'copy-b1',
  foundRevision: 'B',
  evidenceId: 'evidence-b1'
});
inspection.documents = [editable, removable];

updateDocumentMetadata(inspection, 'doc-a', {
  code: 'PW-001-REV',
  description: 'Documento A corrigido',
  expectedRevision: 'C'
}, { actor: 'admin@example.com', at: '2026-08-18T11:00:00.000Z' });

assert.equal(editable.id, 'doc-a');
assert.equal(editable.code, 'PW-001-REV');
assert.equal(editable.sourceCode, 'PW-001');
assert.equal(editable.fieldCopies.length, 1, 'metadata editing must preserve field copies');
assert.equal(editable.fieldCopies[0].evidenceId, 'evidence-a1', 'metadata editing must preserve evidence linkage');
assert.equal(editable.fieldCopies[0].comment, 'cópia conferida', 'metadata editing must preserve field comments');
assert.equal(inspection.documentAudit.at(-1).action, 'document.updated');
assert.deepEqual(Object.keys(inspection.documentAudit.at(-1).changes).sort(), ['code', 'description', 'expectedRevision']);

assert.throws(
  () => updateDocumentMetadata(inspection, 'doc-b', { code: 'PW-001-REV' }),
  /Já existe um documento/i,
  'exact duplicate PW codes must remain blocked'
);

assert.throws(
  () => updateDocumentMetadata(inspection, 'doc-a', { description: '   ' }),
  /descrição/i,
  'blank document descriptions must remain blocked'
);

assert.throws(() => updateDocumentMetadata(inspection, 'doc-b', { code: 'PW001REV' }), /ambíguo/i, 'ambiguous OCR identities must remain blocked');

const deleted = deleteDocumentLogically(inspection, 'doc-b', {
  actor: 'admin@example.com',
  reason: 'Documento removido da lista operacional',
  at: '2026-08-18T11:10:00.000Z'
});
assert.equal(deleted.id, 'doc-b');
assert.deepEqual(inspection.documents.map(item => item.id), ['doc-a']);
assert.deepEqual(inspection.deletedDocumentIds, ['doc-b']);
assert.equal(inspection.deletedDocuments[0].document.id, 'doc-b');
assert.equal(inspection.deletedDocuments[0].reason, 'Documento removido da lista operacional');
assert.equal(inspection.documentAudit.at(-1).action, 'document.deleted');

assert.throws(
  () => deleteDocumentLogically(inspection, 'doc-a'),
  /pelo menos um documento ativo/i,
  'logical deletion must not remove the last active document'
);

const evidenceOwners = inspectionEvidenceDocuments(inspection);
assert.deepEqual(evidenceOwners.map(item => item.id).sort(), ['doc-a', 'doc-b'], 'evidence traversal must include active and archived document owners');
assert.equal(inspection.documents.length, 1, 'evidence traversal must never reactivate an archived document');
const archivedOwner = evidenceOwners.find(item => item.id === 'doc-b');
archivedOwner.fieldCopies[0].evidencePath = 'workspace/inspection-1/doc-b/copy-b1.jpg';
assert.equal(inspection.deletedDocuments[0].document.fieldCopies[0].evidencePath, 'workspace/inspection-1/doc-b/copy-b1.jpg', 'evidence traversal must expose the archived object by reference so sync progress persists');
inspection.documents.push(inspection.deletedDocuments[0].document);
assert.equal(inspectionEvidenceDocuments(inspection).filter(item => item.id === 'doc-b').length, 1, 'malformed active/archive duplicates must be processed only once');
inspection.documents.pop();

const hydrated = hydrateInspection(inspection);
assert.deepEqual(hydrated.documents.map(item => item.id), ['doc-a']);
assert.deepEqual(hydrated.deletedDocumentIds, ['doc-b']);
assert.equal(hydrated.deletedDocuments[0].document.code, 'PW-002', 'logical deletion must retain the archived document payload');

const incomingA = document({ code: 'PW-001', description: 'Descrição da planilha', status: 'Revisado', expectedRevision: 'D' }, 'incoming-a');
const incomingDeleted = document({ code: 'PW-002', description: 'Documento B reaparecido', status: 'Ativo', expectedRevision: 'B' }, 'incoming-b');
const incomingNew = document({ code: 'PW-003', description: 'Documento C', status: 'Ativo', expectedRevision: 'A' }, 'incoming-c');

const refreshed = buildInspectionListUpdate(hydrated, [incomingA, incomingDeleted, incomingNew]);
assert.deepEqual(refreshed.inspection.documents.map(item => item.code).sort(), ['PW-001', 'PW-002', 'PW-003'], 'a planilha substituta deve definir exatamente o catálogo ativo');
const refreshedA = refreshed.inspection.documents.find(item => item.id === 'doc-a');
assert.ok(refreshedA, 'PW correspondente deve preservar o UUID ativo');
assert.equal(refreshedA.description, 'Descrição da planilha', 'metadados de catálogo devem seguir a nova planilha');
assert.equal(refreshedA.status, 'Revisado');
assert.equal(refreshedA.expectedRevision, 'D');
assert.equal(refreshedA.fieldCopies[0].id, 'copy-a1', 'trabalho de campo deve sobreviver à substituição de catálogo');
assert.equal(refreshedA.fieldCopies[0].evidenceId, 'evidence-a1');
assert.equal(refreshedA.fieldCopies[0].comment, 'cópia conferida');
const reintroducedB = refreshed.inspection.documents.find(item => item.code === 'PW-002');
assert.equal(reintroducedB.id, 'incoming-b', 'PW tombstonado que reaparece deve voltar como nova geração, não ressuscitar o UUID antigo');
assert.ok(refreshed.inspection.deletedDocumentIds.includes('doc-b'), 'UUID antigo deve continuar tombstonado');
assert.equal(refreshed.summary.matched, 1);
assert.equal(refreshed.summary.catalogChanged, 1);
assert.equal(refreshed.summary.reviewedPreserved, 1);
assert.equal(refreshed.summary.added, 2);
assert.equal(refreshed.summary.removed, 0);
assert.equal(refreshed.summary.finalTotal, 3);

const staleRemote = createInspection({ project: 'Linha 17', system: 'AMV', responsible: 'Equipe', location: 'Campo' });
staleRemote.id = inspection.id;
staleRemote.createdAt = inspection.createdAt;
staleRemote.updatedAt = '2026-08-18T10:30:00.000Z';
const staleA = document({ code: 'PW-001', description: 'Documento A remoto', status: 'Ativo', expectedRevision: 'A' }, 'doc-a', '2026-08-18T10:00:00.000Z');
staleA.updatedAt = '2026-08-18T10:30:00.000Z';
const staleB = document({ code: 'PW-002', description: 'Documento B remoto', status: 'Ativo', expectedRevision: 'B' }, 'doc-b', '2026-08-18T10:00:00.000Z');
staleRemote.documents = [staleA, staleB];

const localForMerge = hydrateInspection(inspection);
localForMerge.updatedAt = '2026-08-18T11:10:00.000Z';
const merged = mergeInspection(localForMerge, staleRemote);
assert.equal(merged.documents.some(item => item.id === 'doc-b'), false, 'document tombstone must win over a stale active copy from another device');
assert.equal(merged.documents.find(item => item.id === 'doc-a').code, 'PW-001-REV', 'document metadata must merge by immutable id, not by mutable code');
assert.ok(merged.deletedDocumentIds.includes('doc-b'));
assert.equal(merged.deletedDocuments.find(item => item.document.id === 'doc-b').document.code, 'PW-002');

console.log('Document management lifecycle regression checks passed.');
