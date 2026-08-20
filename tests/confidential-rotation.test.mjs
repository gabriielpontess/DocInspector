import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AES_GCM_IV_BYTES,
  decryptFileKeyEnvelope,
  encryptFileKeyEnvelope,
  generateFileKeyBytes,
  generateWorkspaceKeyBytes,
  importAes256Key
} from '../js/confidential-crypto.js';
import { fromPostgresBytea, toPostgresBytea } from '../js/confidential-storage.js';
import { rewrapConfidentialFileKeyBytea } from '../js/confidential-rotation.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const fileId = '22222222-2222-4222-8222-222222222222';
const otherFileId = '33333333-3333-4333-8333-333333333333';
const oldBytes = generateWorkspaceKeyBytes();
const newBytes = generateWorkspaceKeyBytes();
const fileKeyBytes = generateFileKeyBytes();
const oldKey = await importAes256Key(oldBytes);
const newKey = await importAes256Key(newBytes);
const original = await encryptFileKeyEnvelope(fileKeyBytes, oldKey, {
  workspaceId,
  fileId,
  keyVersion: 1
});
const originalPacked = new Uint8Array(original.iv.byteLength + original.ciphertext.byteLength);
originalPacked.set(original.iv, 0);
originalPacked.set(original.ciphertext, original.iv.byteLength);
const originalBytea = toPostgresBytea(originalPacked);

const rotatedBytea = await rewrapConfidentialFileKeyBytea({
  wrappedFileKey: originalBytea,
  oldWorkspaceKey: oldKey,
  newWorkspaceKey: newKey,
  workspaceId,
  fileId,
  fromKeyVersion: 1,
  toKeyVersion: 2
});
const rotatedRaw = fromPostgresBytea(rotatedBytea);
const recovered = await decryptFileKeyEnvelope({
  iv: rotatedRaw.slice(0, AES_GCM_IV_BYTES),
  ciphertext: rotatedRaw.slice(AES_GCM_IV_BYTES)
}, newKey, {
  workspaceId,
  fileId,
  keyVersion: 2
});
assert.deepEqual([...recovered], [...fileKeyBytes], 'WK rotation must preserve the FEK');

await assert.rejects(
  () => rewrapConfidentialFileKeyBytea({
    wrappedFileKey: originalBytea,
    oldWorkspaceKey: oldKey,
    newWorkspaceKey: newKey,
    workspaceId,
    fileId: otherFileId,
    fromKeyVersion: 1,
    toKeyVersion: 2
  }),
  /operation-specific|decrypt|authentication|cipher|failed/i,
  'wrong file AAD must not rewrap a FEK envelope'
);

const runtime = await readFile('js/confidential-rotation.js', 'utf8');
for (const rpc of [
  'docinspector_begin_member_removal_rotation',
  'docinspector_workspace_rotation_status',
  'docinspector_rewrap_confidential_file_key',
  'docinspector_finish_workspace_rotation'
]) assert.match(runtime, new RegExp(rpc));
assert.match(runtime, /resumeWorkspaceKeyRotation/);
assert.match(runtime, /oldWorkspaceKeyBytes\.fill\(0\)/);
assert.match(runtime, /newWorkspaceKeyBytes\.fill\(0\)/);
assert.doesNotMatch(runtime, /\.storage\b/);
assert.doesNotMatch(runtime, /service[_-]?role/i);

const migrationPath = 'supabase/migrations/20260820195245_add_confidential_member_removal_rotation.sql';
const migration = await readFile(migrationPath, 'utf8');
assert.match(migration, /private\.docinspector_workspace_key_rotations/);
assert.match(migration, /docinspector_block_confidential_upload_during_rotation/);
assert.match(migration, /before insert on public\.docinspector_project_documents/i);
assert.match(migration, /security definer/gi);
assert.match(migration, /set search_path = ''/g);
assert.match(migration, /auth\.uid\(\)/);
for (const signature of [
  /docinspector_begin_member_removal_rotation\(uuid, uuid, integer, integer, bytea\) from public, anon/,
  /docinspector_workspace_rotation_status\(uuid\) from public, anon/,
  /docinspector_rewrap_confidential_file_key\(uuid, uuid, integer, integer, bytea\) from public, anon/,
  /docinspector_finish_workspace_rotation\(uuid, integer, integer\) from public, anon/
]) assert.match(migration, signature);

const deactivateIndex = migration.indexOf('update public.docinspector_workspace_members');
const nextKeyIndex = migration.indexOf('insert into public.docinspector_workspace_crypto_keys');
assert.ok(deactivateIndex >= 0 && nextKeyIndex > deactivateIndex, 'membership must be deactivated before the next WK metadata is created');
assert.match(migration, /d\.status = 'ACTIVE'[\s\S]*d\.workspace_key_version <> p_to_key_version/);
assert.match(migration, /not exists \([\s\S]*docinspector_workspace_key_envelopes e/);
assert.doesNotMatch(migration, /storage\.objects\s+(set|update|delete|insert)/i);

const indexMigration = await readFile('supabase/migrations/20260820200104_index_confidential_rotation_foreign_keys.sql', 'utf8');
assert.match(indexMigration, /docinspector_workspace_key_rotations_from_key_idx/);
assert.match(indexMigration, /\(workspace_id, from_key_version\)/);
assert.match(indexMigration, /docinspector_workspace_key_rotations_removed_user_idx/);
assert.match(indexMigration, /\(removed_user_id\)/);
assert.match(indexMigration, /docinspector_workspace_key_rotations_started_by_idx/);
assert.match(indexMigration, /\(started_by\)/);

oldBytes.fill(0);
newBytes.fill(0);
fileKeyBytes.fill(0);
recovered.fill(0);
console.log('Confidential member-removal rotation regression checks passed.');
