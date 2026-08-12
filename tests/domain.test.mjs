import assert from 'node:assert/strict';
import {
  addFieldCopy,
  createInspection,
  hydrateDocument,
  markNotFound,
  metrics,
  recalculateDocument,
  removeFieldCopy,
  updateFieldCopy,
  RESULT,
  validateInspection
} from '../js/domain.js';

const doc = hydrateDocument({
  id: crypto.randomUUID(),
  code: 'PW-001',
  description: 'Teste',
  status: 'Emitido',
  expectedRevision: 'A',
  result: RESULT.PENDING,
  fieldCopies: []
});

const c1 = addFieldCopy(doc, { foundRevision: 'A', source: 'manual' });
assert.equal(doc.result, RESULT.CONFORMING);
const c2 = addFieldCopy(doc, { foundRevision: 'B', source: 'manual' });
assert.equal(doc.result, RESULT.NONCONFORMING);
assert.equal(doc.copyCount, 2);

removeFieldCopy(doc, c2.id);
assert.equal(doc.result, RESULT.CONFORMING);
assert.ok(doc.deletedCopyIds.includes(c2.id));

const resurrectAttempt = hydrateDocument({ ...doc, fieldCopies: [...doc.fieldCopies, c2] });
recalculateDocument(resurrectAttempt);
assert.equal(resurrectAttempt.fieldCopies.some(c => c.id === c2.id), false);
assert.equal(resurrectAttempt.copyCount, 1);

assert.throws(() => markNotFound(doc), /já possui cópias confirmadas/);
removeFieldCopy(doc, c1.id);
markNotFound(doc);
assert.equal(doc.result, RESULT.NOT_FOUND);
assert.equal(doc.copyCount, 0);

const inspection = createInspection({ project: 'P', system: 'S', responsible: 'R', location: 'L' });
inspection.documents = [hydrateDocument({ code: 'PW-001', expectedRevision: 'A' })];
assert.equal(validateInspection(inspection).documents.length, 1);
assert.throws(() => validateInspection({ ...inspection, documents: [...inspection.documents, { code: '' }] }), /perda silenciosa/);

const m = metrics([hydrateDocument({ code:'A', expectedRevision:'1', result: RESULT.PENDING }), hydrateDocument({ code:'B', expectedRevision:'1', result: RESULT.NOT_FOUND })]);
assert.deepEqual(m, { total: 2, verified: 1, conforming: 0, nonconforming: 0, notFound: 1, pending: 1 });

const editable = hydrateDocument({ code:'EDIT', expectedRevision:'A', fieldCopies:[] });
const editableCopy = addFieldCopy(editable, { foundRevision:'B', comment:'antes' });
assert.equal(editable.result, RESULT.NONCONFORMING);
updateFieldCopy(editable, editableCopy.id, { foundRevision:'A', comment:'depois' });
assert.equal(editable.result, RESULT.CONFORMING);
assert.equal(editable.fieldCopies[0].comment, 'depois');

console.log('domain.test.mjs: OK');
