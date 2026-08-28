import assert from 'node:assert/strict';
import { analyzeDocumentFromText, codesEquivalent, detectRevisionFromText, extractCodeCandidates, otsuThreshold } from '../js/vision.js';

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

const separatorsLost = analyzeDocumentFromText('CÓDIGO: DE 17 02 02 00 6P5 1302', docs);
assert.equal(separatorsLost.document?.code, docs[0].code, 'código com separadores perdidos pelo OCR deve continuar reconhecível após rótulo explícito');
assert.equal(separatorsLost.exact, true);

const noisyLabeled = analyzeDocumentFromText('CODIGO: DE 17 02 02 00 6P5 1302 DESENHO GERAL', docs);
assert.equal(noisyLabeled.document?.code, docs[0].code, 'prefixos rotulados devem permitir separar o código de texto posterior sem alterar caracteres');

const noFuzzySubstitution = analyzeDocumentFromText('CODIGO: DE 17 O2 02 00 6P5 1302', docs);
assert.equal(noFuzzySubstitution.document, null, 'OCR não pode converter O em 0 para encaixar na lista');

assert.equal(detectRevisionFromText('Rev. 0'), '0');
assert.equal(detectRevisionFromText('REVISÃO\n1'), '1');
assert.equal(detectRevisionFromText('REVISÃO DE'), '');
assert.equal(detectRevisionFromText('Descrição da Revisão'), '');
assert.ok(extractCodeCandidates('Código PW: AB-12.00/XYZ-999').length >= 1);

const histogram = new Array(256).fill(0);
histogram[40] = 80;
histogram[180] = 220;
const threshold = otsuThreshold(histogram, 300);
assert.ok(threshold >= 40 && threshold < 180, `limiar Otsu deve separar picos escuro/claro; recebido ${threshold}`);

const ambiguousDocs = [{ code: 'AB-12.34-567' }, { code: 'AB12-34567' }];
const ambiguous = analyzeDocumentFromText('Código AB-12.34-567', ambiguousDocs);
assert.equal(ambiguous.document, null);
assert.equal(ambiguous.ambiguous, true);

console.log('vision.test.mjs: OCR extraction, ambiguity and adaptive threshold OK');
