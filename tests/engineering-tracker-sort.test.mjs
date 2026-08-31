import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument } from '../js/domain.js';
import { appendEngineeringAuditEvent, listEngineeringContexts } from '../js/engineering-tracker-core.js';

function doc(id, code, marking) {
  const document = makeDocument({ code, description: code, status: 'Emitido', expectedRevision: 'A' });
  document.id = id;
  addFieldCopy(document, { id: `${id}-copy`, foundRevision: 'A', markings: [marking] });
  return document;
}
const yellow = doc('yellow','PW-Y','Amarelo');
const red = doc('red','PW-R','Vermelho');
const inspection = { id:'i', name:'I', project:'P', system:'S', responsible:'R', location:'', createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-01T00:00:00.000Z', documents:[yellow,red], deletedDocumentIds:[], deletedDocuments:[], documentAudit:[] };
appendEngineeringAuditEvent(inspection, 'yellow', { sentAt:'2026-08-01' }, { eventId:'send-yellow', at:'2026-08-01T01:00:00.000Z' });
assert.equal(listEngineeringContexts([inspection])[0].document.id, 'red', 'red marking has priority even when yellow is awaiting return');

console.log('engineering-tracker-sort.test.mjs: OK');
