import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument, markNotFound, RESULT } from '../js/domain.js';
import { buildInspectionListUpdate } from '../js/inspection-update.js';

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
    documents
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

const { inspection: updated, summary } = buildInspectionListUpdate(before, incoming);

assert.deepEqual(before, beforeSnapshot, 'a atualização não pode mutar a inspeção original');
assert.equal(summary.reviewedPreserved, 1);
assert.equal(summary.reviewedRetained, 1);
assert.equal(summary.pendingRemoved, 1);
assert.equal(summary.added, 1);
assert.equal(updated.documents.length, 3);

const preserved = updated.documents.find(document => document.id === 'reviewed-1');
assert.ok(preserved, 'o documento revisado deve manter o mesmo id');
assert.equal(preserved.description, 'Descrição atualizada');
assert.equal(preserved.status, 'Liberado');
assert.equal(preserved.expectedRevision, 'B');
assert.equal(preserved.fieldCopies.length, 1);
assert.equal(preserved.fieldCopies[0].id, 'copy-1');
assert.equal(preserved.fieldCopies[0].comment, 'Conferido em campo');
assert.equal(preserved.fieldCopies[0].evidenceId, 'evidence-1');
assert.equal(preserved.fieldCopies[0].evidencePath, 'workspace/evidence-1.jpg');
assert.equal(preserved.result, RESULT.NONCONFORMING, 'resultado deve refletir a nova revisão esperada sem apagar a revisão encontrada');

const retained = updated.documents.find(document => document.id === 'reviewed-removed');
assert.ok(retained, 'documento revisado ausente da nova lista deve ser conservado');
assert.equal(retained.result, RESULT.NOT_FOUND);
assert.equal(retained.comment, 'Não localizado em campo');
assert.ok(!updated.documents.some(document => document.id === 'pending-removed'), 'pendente ausente da nova lista pode ser removido');
assert.ok(updated.documents.some(document => document.code === 'PW-004' && document.result === RESULT.PENDING));

const punctuationExisting = imported('PW-10.20', 'Original', 'Emitido', 'A');
punctuationExisting.id = 'punctuation-id';
addFieldCopy(punctuationExisting, { id: 'copy-punctuation', foundRevision: 'A' });
const punctuationUpdate = buildInspectionListUpdate(
  inspection([punctuationExisting]),
  [imported('PW1020', 'Mesmo documento com nova grafia', 'Emitido', 'A')]
).inspection.documents[0];
assert.equal(punctuationUpdate.id, 'punctuation-id', 'identidade alfanumérica única deve preservar o documento mesmo com mudança de pontuação');
assert.equal(punctuationUpdate.fieldCopies[0].id, 'copy-punctuation');

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
assert.equal(duplicateResult.summary.reviewedRetained, 1, 'o outro duplicado revisado deve ser preservado, nunca sobrescrito pelo índice');
assert.equal(duplicateResult.inspection.documents.filter(document => document.code === 'PW-DUP').length, 2, 'nenhum duplicado revisado pode desaparecer durante a atualização');
assert.ok(duplicateResult.inspection.documents.some(document => document.id === 'duplicate-a'), 'primeiro candidato exato deve continuar endereçável');
assert.ok(duplicateResult.inspection.documents.some(document => document.id === 'duplicate-b'), 'segundo candidato exato deve continuar preservado');

console.log('inspection-update.test.mjs: OK');
