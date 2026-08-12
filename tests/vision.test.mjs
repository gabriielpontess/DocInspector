import assert from 'node:assert/strict';
import { analyzeDocumentFromText, codesEquivalent, detectRevisionFromText, extractCodeCandidates } from '../js/vision.js';

const docs = [
  { code: 'DE-17.02.02.00/6P5-1302' },
  { code: 'AB-12.00/XYZ-999' }
];

assert.equal(codesEquivalent('DE-17.02.02.00/6P5-1302', 'DE 17 02 02 00 6P5 1302'), true);
assert.equal(codesEquivalent('DE-17.02.12.00/6P5-1302', 'DE-17.02.02.00/6P5-1302'), false);

const outside = analyzeDocumentFromText('Código DE-17.02.12.00/6P5-1302', docs);
assert.equal(outside.document, null);
assert.match(outside.detectedCode, /12/);

const inside = analyzeDocumentFromText('Código: DE-17.02.02.00/6P5-1302', docs);
assert.equal(inside.document?.code, docs[0].code);
assert.equal(inside.exact, true);

assert.equal(detectRevisionFromText('Rev. 0'), '0');
assert.equal(detectRevisionFromText('REVISÃO\n1'), '1');
assert.equal(detectRevisionFromText('REVISÃO DE'), '');
assert.equal(detectRevisionFromText('Descrição da Revisão'), '');
assert.ok(extractCodeCandidates('Código PW: AB-12.00/XYZ-999').length >= 1);
console.log('vision.test.mjs: OK');

const ambiguousDocs = [{ code: 'AB-12.34-567' }, { code: 'AB12-34567' }];
const ambiguous = analyzeDocumentFromText('Código AB-12.34-567', ambiguousDocs);
assert.equal(ambiguous.document, null);
assert.equal(ambiguous.ambiguous, true);
console.log('vision ambiguity: OK');
