import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildInspectionExportData } from '../js/xlsx.js';
import { hydrateDocument, RESULT } from '../js/domain.js';

const inspection = {
  id: 'inspection-1', name: 'Teste', project: 'P', system: 'S', responsible: 'R', location: 'L',
  documents: [
    hydrateDocument({ id:'d1', code:'PW-1', description:'NC', expectedRevision:'A', fieldCopies:[{ id:'c1', foundRevision:'B', sequence:1, confirmed:true }] }),
    hydrateDocument({ id:'d2', code:'PW-2', description:'NF', expectedRevision:'A', result:RESULT.NOT_FOUND, fieldCopies:[] }),
    hydrateDocument({ id:'d3', code:'PW-3', description:'Pendente', expectedRevision:'A', result:RESULT.PENDING, fieldCopies:[] })
  ]
};
const data = buildInspectionExportData(inspection, { includeConforming:false, includeNonconforming:true, includeNotFound:true, includePending:false, includeCopies:true });
assert.deepEqual(data.documents.map(row => row['Código PW']), ['PW-1','PW-2']);
assert.equal(new Set(data.documents.map(row => row['Código PW'])).size, data.documents.length);
assert.equal(data.copies.length, 1);
assert.equal(data.metrics.verified, 2);
assert.equal(data.metrics.pending, 0);

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const report = fs.readFileSync(new URL('../js/report.js', import.meta.url), 'utf8');
const word = fs.readFileSync(new URL('../js/word.js', import.meta.url), 'utf8');
assert.match(app, /id="copy-quantity"/);
assert.match(app, /data-copy-edit=/);
assert.match(app, /id="next-document"/);
assert.match(app, /id="clear-pw-search"/);
assert.match(app, /Registrar por foto/);
assert.match(app, /documents-dashboard/);
assert.doesNotMatch(app.match(/function inspectView\(\)[\s\S]*?function normalizeSearchText/)?.[0] || '', /global-dashboard/);
assert.match(report, /boundedLines/);
assert.match(report, /maxLines: 4/);
assert.match(word, /application\/msword/);
console.log('feature-export-verification-documents.test.mjs: OK');
