import assert from 'node:assert/strict';
import { addFieldCopy, makeDocument } from '../js/domain.js';
import { listEngineeringContexts } from '../js/engineering-tracker-core.js';

const document = makeDocument({ code: 'PW-ARCHIVE', description: 'Archived', status: 'Emitido', expectedRevision: 'A' });
document.id = 'archived-doc';
addFieldCopy(document, { id: 'archived-copy', foundRevision: 'A', markings: ['Vermelho'] });
const inspection = { id:'archive-inspection', name:'Archive', project:'P', system:'S', responsible:'R', location:'', createdAt:'2026-08-01T00:00:00.000Z', updatedAt:'2026-08-01T00:00:00.000Z', documents:[], deletedDocumentIds:['archived-doc'], deletedDocuments:[{ document, deletedAt:'2026-08-02T00:00:00.000Z' }], documentAudit:[] };
assert.deepEqual(listEngineeringContexts([inspection]), []);

console.log('engineering-tracker-active-only.test.mjs: OK');
