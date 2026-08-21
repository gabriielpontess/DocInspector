import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertDipdfCiphertext,
  confidentialCacheKey,
  confidentialInspectionScope,
  prepareConfidentialCacheRecord,
  CONFIDENTIAL_OFFLINE_DB_NAME,
  CONFIDENTIAL_OFFLINE_MIME
} from '../js/confidential-offline.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const inspectionId = '22222222-2222-4222-8222-222222222222';
const fileId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function fixtureContainer() {
  const encoder = new TextEncoder();
  const ciphertext = new Uint8Array(32).fill(7);
  const header = encoder.encode(JSON.stringify({
    version: 'DIPDF1',
    chunks: [{ iv: 'AAAAAAAAAAAAAAAA', length: ciphertext.byteLength }]
  }));
  return concat([encoder.encode('DIPDF1\n'), u32(header.byteLength), header, ciphertext]);
}

const document = {
  id: fileId,
  workspace_id: workspaceId,
  inspection_id: inspectionId,
  document_id: documentId,
  object_path: `${workspaceId}/${inspectionId}/${fileId}.dipdf`,
  crypto_version: 'DIPDF1',
  workspace_key_version: 1,
  wrapped_file_key: '\\x' + 'aa'.repeat(48),
  metadata_ciphertext: '\\x' + 'bb'.repeat(48),
  metadata_iv: '\\x' + 'cc'.repeat(12),
  plaintext_size: 1200,
  ciphertext_size: 1400,
  chunk_count: 1,
  ciphertext_sha256: 'd'.repeat(64),
  status: 'ACTIVE'
};

assert.equal(CONFIDENTIAL_OFFLINE_DB_NAME, 'docinspector-confidential-vault-v1');
assert.equal(CONFIDENTIAL_OFFLINE_MIME, 'application/octet-stream');
assert.equal(
  confidentialCacheKey({ workspaceId, inspectionId, fileId }),
  `${workspaceId}:${inspectionId}:${fileId}`
);
assert.equal(
  confidentialInspectionScope({ workspaceId, inspectionId }),
  `${workspaceId}:${inspectionId}`
);

const container = fixtureContainer();
assert.deepEqual(assertDipdfCiphertext(container), container);
const record = prepareConfidentialCacheRecord({ document, container });
assert.equal(record.document.id, fileId);
assert.equal(record.document.document_id, documentId, 'document_id não confidencial deve ser preservado no cache offline');
assert.ok(record.container instanceof ArrayBuffer, 'ciphertext offline deve usar ArrayBuffer compatível com WebKit IndexedDB');
assert.equal(record.container.byteLength, container.byteLength);
assert.equal('plaintext' in record, false);
assert.equal('metadata' in record, false);
assert.equal(JSON.stringify(record).includes('projeto-secreto.pdf'), false);

assert.throws(
  () => prepareConfidentialCacheRecord({
    document: { ...document, filename: 'segredo.pdf' },
    container
  }),
  /plaintext proibido/i
);
assert.throws(
  () => prepareConfidentialCacheRecord({
    document: { ...document, workspaceKey: 'secret-key-material' },
    container
  }),
  /plaintext proibido/i
);

assert.throws(
  () => prepareConfidentialCacheRecord({
    document: { ...document, object_path: `${workspaceId}/${inspectionId}/outro.dipdf` },
    container
  }),
  /path criptografado/i
);

const tampered = container.slice();
tampered[0] ^= 1;
assert.throws(() => assertDipdfCiphertext(tampered), /DIPDF1 inválido/i);

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(packageJson.dependencies?.['pdfjs-dist'], '6.2.108');
assert.equal(packageJson.scripts?.build, 'npm run build:pdfjs');
assert.match(packageJson.scripts?.['build:pdfjs'] || '', /vendor-pdfjs/);
assert.match(packageJson.scripts?.['pretest:e2e'] || '', /build:pdfjs/);

const netlify = await readFile('netlify.toml', 'utf8');
assert.match(netlify, /command\s*=\s*"npm run build"/);

const vendorScript = await readFile('scripts/vendor-pdfjs.mjs', 'utf8');
assert.match(vendorScript, /legacy\/build\/pdf\.min\.mjs/);
assert.match(vendorScript, /legacy\/build\/pdf\.worker\.min\.mjs/);
assert.match(vendorScript, /EXPECTED_VERSION = '6\.2\.108'/);

const viewer = await readFile('js/confidential-viewer.js', 'utf8');
assert.match(viewer, /PDFJS_VERSION = '6\.2\.108'/);
assert.match(viewer, /isEvalSupported:\s*false/);
assert.match(viewer, /pdfData\.fill\(0\)/);
assert.doesNotMatch(viewer, /createObjectURL/);
assert.doesNotMatch(viewer, /cdn\.jsdelivr|unpkg\.com|cdnjs/i);

const sw = await readFile('sw.js', 'utf8');
assert.match(sw, /pdf\.worker\.min\.mjs/);
assert.match(sw, /isConfidentialCiphertextRequest/);
assert.match(sw, /\.dipdf/);

console.log('Confidential PDF offline viewer regression checks passed.');

const mobileWorkflow = await readFile('.github/workflows/mobile-actions-e2e.yml', 'utf8');
assert.match(mobileWorkflow, /'sw\.js'/);