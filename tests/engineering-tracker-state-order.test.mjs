import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument } from '../js/domain.js';
import { appendEngineeringAuditEvent, currentEngineeringState } from '../js/engineering-tracker-core.js';

const document = makeDocument({ code: 'PW-ORDER', description: 'Order', status: 'Emitido', expectedRevision: 'A' });
document.id = 'order-doc';
addFieldCopy(document, { id: 'order-copy', foundRevision: 'A', markings: ['Vermelho'] });
const inspection = { id:'order-inspection', name:'Order', project:'P', system:'S', responsible:'R', location:'', createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-01T00:00:00.000Z', documents:[document], deletedDocumentIds:[], deletedDocuments:[], documentAudit:[] };

appendEngineeringAuditEvent(inspection, document.id, { sentAt:'2026-08-01', note:'A' }, { at:'2026-08-02T00:00:00.000Z', eventId:'event-a' });
appendEngineeringAuditEvent(inspection, document.id, { sentAt:'2026-08-01', note:'B' }, { at:'2026-08-02T00:00:00.000Z', eventId:'event-b' });
assert.equal(currentEngineeringState(inspection, document.id).note, 'B', 'same-timestamp concurrent events must resolve deterministically by event id');

console.log('engineering-tracker-state-order.test.mjs: OK');
