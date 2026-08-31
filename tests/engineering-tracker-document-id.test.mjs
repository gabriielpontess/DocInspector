import assert from 'node:assert/strict';
import { appendEngineeringAuditEvent } from '../js/engineering-tracker-core.js';
const inspection = { id:'i', name:'I', project:'P', system:'S', responsible:'R', location:'', createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-01T00:00:00.000Z', documents:[], deletedDocumentIds:[], deletedDocuments:[], documentAudit:[] };
assert.throws(() => appendEngineeringAuditEvent(inspection, 'missing', { sentAt:'2026-08-01' }), /Documento não encontrado/i);
console.log('engineering-tracker-document-id.test.mjs: OK');
