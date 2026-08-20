import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildConfidentialObjectPath,
  decryptConfidentialPdf,
  encryptConfidentialPdf,
  fromPostgresBytea,
  packDipdfContainer,
  toPostgresBytea,
  unpackDipdfContainer,
  CONFIDENTIAL_PDF_BUCKET,
  CONFIDENTIAL_PDF_MIME,
  CONFIDENTIAL_PDF_MAX_PLAINTEXT_BYTES
} from '../js/confidential-storage.js';
import {
  generateWorkspaceKeyBytes,
  importAes256Key
} from '../js/confidential-crypto.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const inspectionId = '22222222-2222-4222-8222-222222222222';
const fileId = '33333333-3333-4333-8333-333333333333';

assert.equal(CONFIDENTIAL_PDF_BUCKET, 'docinspector-confidential-pdfs');
assert.equal(CONFIDENTIAL_PDF_MIME, 'application/octet-stream');
assert.equal(CONFIDENTIAL_PDF_MAX_PLAINTEXT_BYTES, 20 * 1024 * 1024);
assert.equal(
  buildConfidentialObjectPath({ workspaceId, inspectionId, fileId }),
  `${workspaceId}/${inspectionId}/${fileId}.dipdf`
);
assert.throws(
  () => buildConfidentialObjectPath({ workspaceId: '../escape', inspectionId, fileId }),
  /workspaceId inválido/i
);

const byteaSource = crypto.getRandomValues(new Uint8Array(48));
assert.deepEqual(fromPostgresBytea(toPostgresBytea(byteaSource)), byteaSource);

const wkBytes = generateWorkspaceKeyBytes();
const workspaceKey = await importAes256Key(wkBytes);
const pdf = new TextEncoder().encode('%PDF-1.7\nDocInspector confidential test\n%%EOF');
const encrypted = await encryptConfidentialPdf({
  plaintext: pdf,
  workspaceId,
  inspectionId,
  fileId,
  workspaceKey,
  workspaceKeyVersion: 1,
  metadata: {
    filename: 'projeto-secreto.pdf',
    title: 'Projeto',
    description: 'Documento E2EE'
  }
});

assert.equal(encrypted.document.crypto_version, 'DIPDF1');
assert.equal(encrypted.document.plaintext_size, pdf.byteLength);
assert.equal(encrypted.document.chunk_count, 1);
assert.match(encrypted.document.ciphertext_sha256, /^[0-9a-f]{64}$/);
assert.equal(unpackDipdfContainer(encrypted.container).length, 1);

const decrypted = await decryptConfidentialPdf({
  container: encrypted.container,
  document: encrypted.document,
  workspaceKey
});
assert.deepEqual(decrypted.plaintext, pdf);
assert.deepEqual(decrypted.metadata, {
  filename: 'projeto-secreto.pdf',
  title: 'Projeto',
  description: 'Documento E2EE'
});

const tampered = encrypted.container.slice();
tampered[tampered.length - 1] ^= 1;
await assert.rejects(
  decryptConfidentialPdf({ container: tampered, document: encrypted.document, workspaceKey }),
  /integridade/i
);

const chunks = unpackDipdfContainer(encrypted.container);
const repacked = packDipdfContainer(chunks);
assert.deepEqual(repacked, encrypted.container);

await assert.rejects(
  encryptConfidentialPdf({
    plaintext: new TextEncoder().encode('not-a-pdf'),
    workspaceId,
    inspectionId,
    fileId,
    workspaceKey,
    workspaceKeyVersion: 1,
    metadata: { filename: 'x.pdf' }
  }),
  /assinatura PDF válida/i
);

wkBytes.fill(0);

const migration = await readFile(
  'supabase/migrations/20260820175432_add_confidential_pdf_storage_policies.sql',
  'utf8'
);
assert.match(migration, /docinspector_enforce_confidential_document_limits/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /v_count >= 10/i);
assert.match(migration, /209715200/i);
assert.match(migration, /bucket_id = 'docinspector-confidential-pdfs'/i);
assert.match(migration, /d\.status = 'ACTIVE'/i);
assert.match(migration, /d\.status = 'UPLOADING'/i);
assert.match(migration, /d\.status in \('UPLOADING', 'DELETED'\)/i);
assert.match(migration, /m\.role in \('ADMIN', 'INSPECTOR'\)/i);
assert.match(migration, /e\.member_user_id = \(select auth\.uid\(\)\)/i);
assert.doesNotMatch(migration, /for update\s+to authenticated/i);

console.log('Confidential PDF encrypted transport regression checks passed.');
