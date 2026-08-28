import assert from 'node:assert/strict';
import { makeDocument } from '../js/domain.js';
import { appendEngineeringAuditEvent } from '../js/engineering-tracker-core.js';
const document = makeDocument({ code:'PW-NO-MARK', description:'No mark', status:'Emitido', expectedRevision:'A' });
document.id = 'no-mark';
const inspection = { id:'i', name:'I', project:'P', system:'S', responsible:'R', location:'', createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-01T00:00:00.000Z', documents:[document], deletedDocumentIds:[], deletedDocuments:[], documentAudit:[] };
assert.throws(() => appendEngineeringAuditEvent(inspection, document.id, { sentAt:'2026-08-01' }), /Amarelo ou Vermelho/i);
assert.equal(inspection.documentAudit.length, 0);
console.log('engineering-tracker-no-unmarked-save.test.mjs: OK');
