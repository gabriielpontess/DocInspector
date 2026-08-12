import assert from 'node:assert/strict';
import { mergeInspection } from '../js/sync.js';
import { hydrateInspection } from '../js/domain.js';

const inspectionId = crypto.randomUUID();
const documentId = crypto.randomUUID();
const copyId = crypto.randomUUID();
const base = {
  id: inspectionId,
  project: 'Projeto', system: 'Sistema', responsible: 'Resp', location: '',
  createdAt: '2026-08-11T10:00:00.000Z', updatedAt: '2026-08-11T10:01:00.000Z',
  documents: [{
    id: documentId, code: 'PW-001', description: '', status: '', expectedRevision: 'A',
    result: 'Conforme', verifiedAt: '2026-08-11T10:01:00.000Z', deletedCopyIds: [],
    fieldCopies: [{ id: copyId, sequence: 1, foundRevision: 'A', source: 'manual', capturedAt:'2026-08-11T10:01:00.000Z', updatedAt:'2026-08-11T10:01:00.000Z', confirmed:true }]
  }]
};
const remote = structuredClone(base);
remote.updatedAt = '2026-08-11T10:02:00.000Z';
const local = structuredClone(base);
local.documents[0].fieldCopies = [];
local.documents[0].deletedCopyIds = [copyId];
local.documents[0].result = 'Pendente';
local.documents[0].verifiedAt = null;
local.updatedAt = '2026-08-11T10:03:00.000Z';
const merged = mergeInspection(hydrateInspection(local), hydrateInspection(remote));
assert.equal(merged.documents[0].fieldCopies.length, 0);
assert.ok(merged.documents[0].deletedCopyIds.includes(copyId));
assert.equal(merged.documents[0].result, 'Pendente');
console.log('sync-merge.test.mjs: OK');
