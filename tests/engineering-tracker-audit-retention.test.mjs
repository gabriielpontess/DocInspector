import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument } from '../js/domain.js';
import { appendEngineeringAuditEvent, currentEngineeringState } from '../js/engineering-tracker-core.js';

const document = makeDocument({ code: 'PW-AUDIT', description: 'Audit budget', status: 'Emitido', expectedRevision: 'A' });
document.id = 'audit-doc';
addFieldCopy(document, { id: 'audit-copy', foundRevision: 'A', markings: ['Amarelo'] });
const inspection = {
  id: 'audit-inspection', name: 'Audit', project: 'P', system: 'S', responsible: 'R', location: '',
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  documents: [document], deletedDocumentIds: [], deletedDocuments: [], documentAudit: []
};

for (let index = 0; index < 1005; index += 1) {
  appendEngineeringAuditEvent(inspection, document.id, {
    sentAt: '2026-08-01', note: `evento-${index}`
  }, {
    eventId: `event-${String(index).padStart(4, '0')}`,
    at: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString()
  });
}

assert.equal(inspection.documentAudit.length, 1000, 'audit must stay within the existing inspection payload budget');
assert.equal(currentEngineeringState(inspection, document.id).note, 'evento-1004');
assert.equal(inspection.documentAudit.some(event => event.id === 'event-0000'), false, 'oldest audit event should be evicted by the existing bounded history policy');

console.log('engineering-tracker-audit-retention.test.mjs: OK');
