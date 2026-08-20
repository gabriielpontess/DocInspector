import assert from 'node:assert/strict';
import {
  PDF_CONTAINER_VERSION,
  buildPdfChunkAdditionalData,
  decryptFileKeyEnvelope,
  decryptPdfChunk,
  encryptFileKeyEnvelope,
  encryptMemberPrivateKeyBackup,
  encryptPdfChunk,
  exportMemberPrivateKeyPkcs8,
  exportMemberPublicKeyJwk,
  generateFileKeyBytes,
  generateMemberEncryptionKeyPair,
  generateRecoverySecret,
  generateWorkspaceKeyBytes,
  importAes256Key,
  importMemberPrivateKeyPkcs8,
  importMemberPublicKeyJwk,
  recoverMemberPrivateKey,
  rewrapFileKeyEnvelope,
  unwrapWorkspaceKeyForMember,
  wrapWorkspaceKeyForMember
} from '../js/confidential-crypto.js';

function assertBytesEqual(actual, expected, message) {
  assert.deepEqual([...actual], [...expected], message);
}

async function assertCryptoRejects(operation, message) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof Error, message);
    return true;
  }, message);
}

const memberA = await generateMemberEncryptionKeyPair();
const memberB = await generateMemberEncryptionKeyPair();
assert.equal(memberA.privateKey.algorithm.name, 'RSA-OAEP');
assert.equal(memberA.privateKey.algorithm.modulusLength, 3072);
assert.equal(memberA.privateKey.algorithm.hash.name, 'SHA-256');

const publicJwk = await exportMemberPublicKeyJwk(memberA.publicKey);
const importedPublic = await importMemberPublicKeyJwk(publicJwk);
const privatePkcs8 = await exportMemberPrivateKeyPkcs8(memberA.privateKey);
const importedPrivate = await importMemberPrivateKeyPkcs8(privatePkcs8);
assert.equal(importedPrivate.extractable, false, 'normal-use MEK private key must be non-extractable');
privatePkcs8.fill(0);

const workspaceKeyBytes = generateWorkspaceKeyBytes();
const wrappedWorkspaceKey = await wrapWorkspaceKeyForMember(workspaceKeyBytes, importedPublic);
const unwrappedWorkspaceKey = await unwrapWorkspaceKeyForMember(wrappedWorkspaceKey, importedPrivate);
assertBytesEqual(unwrappedWorkspaceKey, workspaceKeyBytes, 'RSA-OAEP must round-trip the workspace key');

await assertCryptoRejects(
  () => unwrapWorkspaceKeyForMember(wrappedWorkspaceKey, memberB.privateKey),
  'a different member private key must not unwrap the workspace key'
);

const workspaceKey = await importAes256Key(workspaceKeyBytes);
const fileKeyBytes = generateFileKeyBytes();
const fileKey = await importAes256Key(fileKeyBytes);
const fileContextV1 = { workspaceId: 'workspace-1', fileId: 'file-1', keyVersion: 1 };
const fileEnvelope = await encryptFileKeyEnvelope(fileKeyBytes, workspaceKey, fileContextV1);
const roundTripFileKey = await decryptFileKeyEnvelope(fileEnvelope, workspaceKey, fileContextV1);
assertBytesEqual(roundTripFileKey, fileKeyBytes, 'AES-GCM must round-trip the FEK envelope');

const chunk0Context = {
  formatVersion: PDF_CONTAINER_VERSION,
  workspaceId: 'workspace-1',
  inspectionId: 'inspection-1',
  fileId: 'file-1',
  chunkIndex: 0,
  totalChunks: 2
};
const chunk1Context = { ...chunk0Context, chunkIndex: 1 };
const plaintext0 = new TextEncoder().encode('%PDF-1.7\nchunk-zero');
const plaintext1 = new TextEncoder().encode('chunk-one');
const chunk0 = await encryptPdfChunk(plaintext0, fileKey, chunk0Context);
const chunk1 = await encryptPdfChunk(plaintext1, fileKey, chunk1Context);
assertBytesEqual(await decryptPdfChunk(chunk0, fileKey, chunk0Context), plaintext0, 'chunk 0 must decrypt');
assertBytesEqual(await decryptPdfChunk(chunk1, fileKey, chunk1Context), plaintext1, 'chunk 1 must decrypt');

const modified = { iv: chunk0.iv, ciphertext: chunk0.ciphertext.slice() };
modified.ciphertext[0] ^= 0x01;
await assertCryptoRejects(
  () => decryptPdfChunk(modified, fileKey, chunk0Context),
  'modified ciphertext must fail AES-GCM authentication'
);

const truncated = { iv: chunk0.iv, ciphertext: chunk0.ciphertext.slice(0, -1) };
await assertCryptoRejects(
  () => decryptPdfChunk(truncated, fileKey, chunk0Context),
  'truncated ciphertext must fail AES-GCM authentication'
);

await assertCryptoRejects(
  () => decryptPdfChunk(chunk0, fileKey, chunk1Context),
  'reordered chunks must fail because chunk index is authenticated'
);

await assertCryptoRejects(
  () => decryptPdfChunk(chunk0, fileKey, { ...chunk0Context, workspaceId: 'workspace-2' }),
  'wrong workspace AAD must fail authentication'
);

await assertCryptoRejects(
  () => decryptPdfChunk(chunk0, fileKey, { ...chunk0Context, fileId: 'file-2' }),
  'wrong file AAD must fail authentication'
);

const aad0 = buildPdfChunkAdditionalData(chunk0Context);
const aad1 = buildPdfChunkAdditionalData(chunk1Context);
assert.notDeepEqual([...aad0], [...aad1], 'chunk index must change authenticated additional data');

const recoverySecret = generateRecoverySecret();
const recoveryBackup = await encryptMemberPrivateKeyBackup(memberA.privateKey, recoverySecret);
const recoveredPrivateKey = await recoverMemberPrivateKey(recoveryBackup, recoverySecret);
assert.equal(recoveredPrivateKey.extractable, false, 'recovered MEK must be non-extractable by default');
const recoveredWorkspaceKey = await unwrapWorkspaceKeyForMember(wrappedWorkspaceKey, recoveredPrivateKey);
assertBytesEqual(recoveredWorkspaceKey, workspaceKeyBytes, 'recovered MEK must decrypt existing WK envelopes');

const wrongRecoverySecret = generateRecoverySecret();
await assertCryptoRejects(
  () => recoverMemberPrivateKey(recoveryBackup, wrongRecoverySecret),
  'wrong Recovery Secret must not decrypt the private-key backup'
);

const nextWorkspaceKeyBytes = generateWorkspaceKeyBytes();
const nextWorkspaceKey = await importAes256Key(nextWorkspaceKeyBytes);
const chunkCiphertextBeforeRotation = chunk0.ciphertext.slice();
const rotatedEnvelope = await rewrapFileKeyEnvelope(fileEnvelope, workspaceKey, nextWorkspaceKey, {
  from: fileContextV1,
  to: { ...fileContextV1, keyVersion: 2 }
});
assertBytesEqual(chunk0.ciphertext, chunkCiphertextBeforeRotation, 'WK rotation must not change PDF ciphertext');
const rotatedFileKeyBytes = await decryptFileKeyEnvelope(
  rotatedEnvelope,
  nextWorkspaceKey,
  { ...fileContextV1, keyVersion: 2 }
);
assertBytesEqual(rotatedFileKeyBytes, fileKeyBytes, 'WK rotation must preserve the FEK');
const rotatedFileKey = await importAes256Key(rotatedFileKeyBytes);
assertBytesEqual(
  await decryptPdfChunk(chunk0, rotatedFileKey, chunk0Context),
  plaintext0,
  'rewrapped FEK must still decrypt the unchanged PDF ciphertext'
);

workspaceKeyBytes.fill(0);
fileKeyBytes.fill(0);
roundTripFileKey.fill(0);
unwrappedWorkspaceKey.fill(0);
recoveredWorkspaceKey.fill(0);
rotatedFileKeyBytes.fill(0);
nextWorkspaceKeyBytes.fill(0);
recoverySecret.fill(0);
wrongRecoverySecret.fill(0);

console.log('Confidential PDF crypto primitive regression checks passed.');
