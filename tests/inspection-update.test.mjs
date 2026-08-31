import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument, markNotFound, RESULT } from '../js/domain.js';
import { updateDocumentMetadata } from '../js/document-lifecycle.js';
import { buildInspectionListUpdate } from '../js/inspection-update.js';
import { listRestorableDeletedDocuments } from '../js/recovery-core.js';

function inspection(documents) {
  return {
    id: 'inspection-1',
    name: '3º e 4º trilho',
    project: 'Linha 17',
    system: '3º e 4º trilho',
    responsible: 'Equipe',
    location: 'Campo',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    documents,
    deletedDocumentIds: [],
    deletedDocuments: [],
    documentAudit: []
  };
}

function imported(code, description, status = 'Emitido', expectedRevision = 'A') {
  return makeDocument({ code, description, status, expectedRevision });
}

const reviewed = imported('PW-001', 'Descrição antiga', 'Emitido', 'A');
reviewed.id = 'reviewed-1';
addFieldCopy(reviewed, {
  id: 'copy-1',
  foundRevision: 'A',
  comment: 'Conferido em campo',
  evidenceId: 'evidence-1',
  evidencePath: 'workspace/evidence-1.jpg',
  source: 'camera',
  capturedAt: '2026-08-10T10:00:00.000Z'
});

const removedReviewed = imported('PW-002', 'Revisado que saiu da lista', 'Emitido', 'B');
removedReviewed.id = 'reviewed-removed';
markNotFound(removedReviewed, 'Não localizado em campo');

const pendingRemoved = imported('PW-003', 'Pendente removido', 'Emitido', 'C');
pendingRemoved.id = 'pending-removed';

const before = inspection([reviewed, removedReviewed, pendingRemoved]);
const beforeSnapshot = structuredClone(before);
const incoming = [
  imported('PW-001', 'Descrição atualizada', 'Liberado', 'B'),
  imported('PW-004', 'Documento novo', 'Emitido', 'A')
];

const { inspection: updated, summary } = buildInspectionListUpdate(before, incoming, {
  actor: 'operator@example.com',
  at: '2026-08-28T12:00:00.000Z'
});

assert.deepEqual(before, beforeSnapshot, 'a atualização não pode mutar a inspeção original');
assert.equal(summary.reviewedPreserved, 1);
assert.equal(summary.reviewedRemoved, 1);
assert.equal(summary.pendingRemoved, 1);
assert.equal(summary.removed, 2);
assert.equal(summary.added, 1);
assert.equal(updated.documents.length, 2, 'a nova planilha deve definir exatamente o catálogo ativo');

const preserved = updated.documents.find(document => document.id === 'reviewed-1');
assert.ok(preserved, 'o documento correspondente deve manter o mesmo id');
assert.equal(preserved.description, 'Descrição atualizada');
assert.equal(preserved.status, 'Liberado');
assert.equal(preserved.expectedRevision, 'B');
assert.equal(preserved.fieldCopies.length, 1);
assert.equal(preserved.fieldCopies[0].id, 'copy-1');
assert.equal(preserved.fieldCopies[0].comment, 'Conferido em campo');
assert.equal(preserved.fieldCopies[0].evidenceId, 'evidence-1');
assert.equal(preserved.fieldCopies[0].evidencePath, 'workspace/evidence-1.jpg');
assert.equal(preserved.result, RESULT.NONCONFORMING, 'resultado deve refletir a nova revisão esperada sem apagar a revisão encontrada');

assert.ok(!updated.documents.some(document => document.id === 'reviewed-removed'), 'revisado ausente não pode continuar ativo');
assert.ok(!updated.documents.some(document => document.id === 'pending-removed'), 'pendente ausente não pode continuar ativo');
assert.ok(updated.documents.some(document => document.code === 'PW-004' && document.result === RESULT.PENDING));
assert.ok(updated.deletedDocumentIds.includes('reviewed-removed'));
assert.ok(updated.deletedDocumentIds.includes('pending-removed'));
assert.equal(updated.deletedDocuments.find(entry => entry.document.id === 'reviewed-removed')?.document.comment, 'Não localizado em campo');
assert.equal(updated.documentAudit.filter(event => event.action === 'document.deleted').length, 2);
assert.ok(updated.documentAudit.every(event => event.changes?.source === 'inspection-list-replacement'));
assert.deepEqual(
  new Set(listRestorableDeletedDocuments(updated).map(entry => entry.document.id)),
  new Set(['reviewed-removed', 'pending-removed']),
  'documentos retirados pela lista devem ficar disponíveis no histórico/restauração'
);

const punctuationExisting = imported('PW-10.20', 'Original', 'Emitido', 'A');
punctuationExisting.id = 'punctuation-id';
addFieldCopy(punctuationExisting, { id: 'copy-punctuation', foundRevision: 'A' });
const punctuationUpdate = buildInspectionListUpdate(
  inspection([punctuationExisting]),
  [imported('PW1020', 'Mesmo documento com nova grafia', 'Emitido', 'A')]
).inspection.documents[0];
assert.equal(punctuationUpdate.id, 'punctuation-id', 'identidade alfanumérica única deve preservar o documento mesmo com mudança de pontuação');
assert.equal(punctuationUpdate.code, 'PW1020', 'a grafia da nova lista deve prevalecer');
assert.equal(punctuationUpdate.fieldCopies[0].id, 'copy-punctuation');

const manuallyEdited = imported('PW-MANUAL', 'Descrição planilha antiga', 'Emitido', 'A');
manuallyEdited.id = 'manual-id';
const manualInspection = inspection([manuallyEdited]);
updateDocumentMetadata(manualInspection, 'manual-id', { description: 'Descrição editada manualmente', expectedRevision: 'Z' }, {
  actor: 'editor@example.com',
  at: '2026-08-20T10:00:00.000Z'
});
const authoritative = buildInspectionListUpdate(
  manualInspection,
  [imported('PW-MANUAL', 'Descrição da planilha nova', 'Liberado', 'C')]
).inspection.documents[0];
assert.equal(authoritative.description, 'Descrição da planilha nova', 'a nova lista deve substituir até metadados anteriormente editados manualmente');
assert.equal(authoritative.expectedRevision, 'C');

const duplicateA = imported('PW-DUP', 'Duplicado A', 'Emitido', 'A');
duplicateA.id = 'duplicate-a';
addFieldCopy(duplicateA, { id: 'copy-duplicate-a', foundRevision: 'A' });
const duplicateB = imported('PW-DUP', 'Duplicado B', 'Emitido', 'A');
duplicateB.id = 'duplicate-b';
addFieldCopy(duplicateB, { id: 'copy-duplicate-b', foundRevision: 'A' });
const duplicateResult = buildInspectionListUpdate(
  inspection([duplicateA, duplicateB]),
  [imported('PW-DUP', 'Catálogo atualizado', 'Liberado', 'B')]
);
assert.equal(duplicateResult.summary.matched, 1, 'um registro de entrada deve consumir apenas um duplicado existente');
assert.equal(duplicateResult.summary.reviewedRemoved, 1, 'o duplicado que não existe na nova lista deve ir para o histórico');
assert.equal(duplicateResult.inspection.documents.filter(document => document.code === 'PW-DUP').length, 1, 'o catálogo ativo deve refletir a cardinalidade da nova lista');
assert.equal(duplicateResult.inspection.deletedDocuments.length, 1);

const reintroduced = buildInspectionListUpdate(
  updated,
  [imported('PW-002', 'PW voltou em revisão futura', 'Emitido', 'D')]
).inspection;
const reintroducedActive = reintroduced.documents.find(document => document.code === 'PW-002');
assert.ok(reintroducedActive, 'PW tombstonado deve poder voltar quando a nova lista autoritativa o contém');
assert.notEqual(reintroducedActive.id, 'reviewed-removed', 'retorno pela planilha deve criar nova geração e manter o UUID antigo tombstonado');
assert.ok(reintroduced.deletedDocumentIds.includes('reviewed-removed'));

console.log('inspection-update.test.mjs: OK');
