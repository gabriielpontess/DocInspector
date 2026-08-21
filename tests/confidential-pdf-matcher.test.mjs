import assert from 'node:assert/strict';
import {
  CONFIDENTIAL_PDF_MATCH,
  matchConfidentialPdfBatch,
  matchConfidentialPdfFile
} from '../js/confidential-pdf-matcher.js';

const documents = [
  { id: '11111111-1111-4111-8111-111111111111', code: 'PW-TR-001', sourceCode: 'PW-TR-001', description: 'Terceiro e quarto trilho alimentação' },
  { id: '22222222-2222-4222-8222-222222222222', code: 'PW-SIG-002', sourceCode: 'PW-SIG-002', description: 'Sinalização plataforma norte' }
];

const exact = matchConfidentialPdfFile({ name: 'PW-TR-001_rev-C.pdf' }, documents);
assert.equal(exact.status, CONFIDENTIAL_PDF_MATCH.EXACT);
assert.equal(exact.documentId, documents[0].id);

const suggested = matchConfidentialPdfFile({ name: 'Sinalizacao plataforma norte.pdf' }, documents);
assert.equal(suggested.status, CONFIDENTIAL_PDF_MATCH.SUGGESTED);
assert.equal(suggested.documentId, documents[1].id);

const missing = matchConfidentialPdfFile({ name: 'scan_004.pdf' }, documents);
assert.equal(missing.status, CONFIDENTIAL_PDF_MATCH.UNLINKED);
assert.equal(missing.documentId, null);

const partialCode = matchConfidentialPdfFile({ name: 'PW-TR-0010.pdf' }, documents);
assert.notEqual(partialCode.status, CONFIDENTIAL_PDF_MATCH.EXACT, 'Código PW não pode casar como substring de outro código.');

const ambiguousDocuments = [
  { id: '33333333-3333-4333-8333-333333333333', code: 'PW-DUP-010', description: 'Projeto duplicado A' },
  { id: '44444444-4444-4444-8444-444444444444', code: 'PW-DUP-010', description: 'Projeto duplicado B' }
];
const ambiguous = matchConfidentialPdfFile({ name: 'PW-DUP-010.pdf' }, ambiguousDocuments);
assert.equal(ambiguous.status, CONFIDENTIAL_PDF_MATCH.UNLINKED);
assert.equal(ambiguous.documentId, null, 'Ambiguidade nunca deve produzir vínculo silencioso.');
assert.equal(ambiguous.candidateDocumentIds.length, 2);

const sameDocumentBatch = matchConfidentialPdfBatch([
  { name: 'PW-TR-001_rev-A.pdf' },
  { name: 'PW-TR-001_as-built.pdf' }
], documents);
assert.equal(sameDocumentBatch.length, 2);
assert.ok(sameDocumentBatch.every(item => item.documentId === documents[0].id));

console.log('Confidential PDF client-side matcher regression checks passed.');
