import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument } from '../js/domain.js';
import { buildInspectionListUpdate } from '../js/inspection-update.js';
import { mergeInspection } from '../js/sync.js';

function doc(id, code, revision = 'A') {
  const document = makeDocument({ code, description: code, status: 'Emitido', expectedRevision: revision });
  document.id = id;
  return document;
}

const keep = doc('keep-id', 'PW-KEEP');
addFieldCopy(keep, { id: 'keep-copy', foundRevision: 'A' });
const remove = doc('remove-id', 'PW-REMOVE');
addFieldCopy(remove, { id: 'remove-copy', foundRevision: 'A', evidencePath: 'workspace/remove.jpg' });
const stale = {
  id: 'inspection-sync',
  name: 'Lista', project: 'Linha 17', system: 'SYS', responsible: 'Equipe', location: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
  documents: [keep, remove],
  deletedDocumentIds: [], deletedDocuments: [], documentAudit: []
};

const replacement = buildInspectionListUpdate(
  stale,
  [doc('incoming-temporary-id', 'PW-KEEP', 'B')],
  { actor: 'device-a', at: '2026-08-28T12:00:00.000Z' }
).inspection;
replacement.updatedAt = '2026-08-28T12:00:00.000Z';

// Simula aparelho B desatualizado que grava depois da substituição e ainda carrega
// o documento removido. O tombstone deve vencer mesmo quando o payload stale é novo.
const staleLater = structuredClone(stale);
staleLater.updatedAt = '2026-08-28T12:05:00.000Z';
staleLater.documents[1].updatedAt = '2026-08-28T12:05:00.000Z';
staleLater.documents[1].comment = 'alteração em aparelho desatualizado';

const merged = mergeInspection(replacement, staleLater);
assert.equal(merged.documents.some(document => document.id === 'remove-id'), false, 'tombstone da lista autoritativa deve impedir ressurreição por aparelho stale');
assert.ok(merged.deletedDocumentIds.includes('remove-id'));
const archive = merged.deletedDocuments.find(entry => entry.document.id === 'remove-id');
assert.ok(archive, 'snapshot arquivado deve sobreviver à reconciliação');
assert.equal(archive.document.fieldCopies[0].evidencePath, 'workspace/remove.jpg');
assert.equal(merged.documents.find(document => document.id === 'keep-id')?.fieldCopies[0].id, 'keep-copy', 'documento correspondente deve conservar dados de campo após merge');

console.log('inspection-list-sync-regression.test.mjs: OK');
