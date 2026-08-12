import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildInspectionExportData } from '../js/xlsx.js';
import { sliceRowLineSets } from '../js/report.js';
import { hydrateDocument, RESULT } from '../js/domain.js';

const duplicateSource = hydrateDocument({ id:'d1', code:'PW-1', description:'NC', expectedRevision:'A', fieldCopies:[{ id:'c1', foundRevision:'B', sequence:1, confirmed:true }] });
const inspection = {
  id: 'inspection-1', name: 'Teste', project: 'P', system: 'S', responsible: 'R', location: 'L',
  documents: [
    duplicateSource,
    structuredClone(duplicateSource),
    hydrateDocument({ id:'d2', code:'PW-2', description:'NF', expectedRevision:'A', result:RESULT.NOT_FOUND, fieldCopies:[] }),
    hydrateDocument({ id:'d3', code:'PW-3', description:'Pendente', expectedRevision:'A', result:RESULT.PENDING, fieldCopies:[] })
  ]
};
const data = buildInspectionExportData(inspection, { includeConforming:false, includeNonconforming:true, includeNotFound:true, includePending:false, includeCopies:true });
assert.deepEqual(data.documents.map(row => row['Código PW']), ['PW-1','PW-2']);
assert.equal(data.documents.length, 2, 'documento duplicado por id deve produzir uma única linha');
assert.equal(data.copies.length, 1, 'cópia do documento duplicado não pode ser repetida');
assert.equal(data.metrics.total, 2, 'resumo deve usar a mesma coleção deduplicada');
assert.equal(data.metrics.verified, 2);
assert.equal(data.metrics.pending, 0);

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const report = fs.readFileSync(new URL('../js/report.js', import.meta.url), 'utf8');
const word = fs.readFileSync(new URL('../js/word.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(app, /id="copy-quantity"/);
assert.match(app, /if \(!input \|\| input\.dataset\.bound\) return;[\s\S]{0,80}input\.dataset\.bound = '1';/, 'contador de cópias deve impedir listeners duplicados');
assert.match(app, /data-copy-edit=/);
assert.match(app, /id="next-document"/);
assert.match(app, /id="clear-pw-search"/);
assert.match(app, /Registrar por foto/);
assert.match(app, /documents-dashboard/);
const inspectViewSource = app.match(/function inspectView\(\)[\s\S]*?function normalizeSearchText/);
assert.ok(inspectViewSource, 'trecho de inspectView deve ser localizado antes de validar a ausência do dashboard');
assert.doesNotMatch(inspectViewSource[0], /global-dashboard/);
assert.doesNotMatch(app, /querySelector\('#global-dashboard'\)/, 'referência morta ao dashboard antigo não deve retornar');
assert.doesNotMatch(report, /boundedLines/);
assert.doesNotMatch(report, /maxLines:/);
const lineSets = [['a1','a2','a3','a4','a5'], ['b1','b2'], ['c1','c2','c3']];
const firstChunk = sliceRowLineSets(lineSets, [0,0,0], 2);
assert.deepEqual(firstChunk.chunkSets, [['a1','a2'], ['b1','b2'], ['c1','c2']]);
assert.deepEqual(firstChunk.nextOffsets, [2,2,2]);
assert.equal(firstChunk.done, false);
const secondChunk = sliceRowLineSets(lineSets, firstChunk.nextOffsets, 2);
assert.deepEqual(secondChunk.chunkSets, [['a3','a4'], [], ['c3']]);
assert.equal(secondChunk.done, false);
const thirdChunk = sliceRowLineSets(lineSets, secondChunk.nextOffsets, 2);
assert.deepEqual(thirdChunk.chunkSets, [['a5'], [], []]);
assert.equal(thirdChunk.done, true);
assert.match(serviceWorker, /const VERSION = '0\.9\.12';/, 'cache do PWA deve invalidar o gerador de PDF anterior');
assert.match(word, /application\/msword/);
console.log('feature-export-verification-documents.test.mjs: OK');
