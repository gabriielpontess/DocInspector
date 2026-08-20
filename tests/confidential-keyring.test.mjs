import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONFIDENTIAL_KEY_DB_NAME,
  decodeRecoverySecret,
  encodeRecoverySecret,
  fingerprintMemberPublicJwk
} from '../js/confidential-keyring.js';
import {
  exportMemberPublicKeyJwk,
  generateMemberEncryptionKeyPair,
  generateRecoverySecret
} from '../js/confidential-crypto.js';

const secret = generateRecoverySecret();
const encoded = encodeRecoverySecret(secret);
assert.match(encoded, /^DI-RS1-[A-Za-z0-9_-]+$/);
assert.deepEqual([...decodeRecoverySecret(encoded)], [...secret]);
assert.throws(() => decodeRecoverySecret('DI-RS1-invalid'), /Recovery Secret inválido/i);
assert.equal(CONFIDENTIAL_KEY_DB_NAME, 'docinspector-confidential-keys-v1');

const pair = await generateMemberEncryptionKeyPair();
const publicJwk = await exportMemberPublicKeyJwk(pair.publicKey);
const fingerprintA = await fingerprintMemberPublicJwk(publicJwk);
const fingerprintB = await fingerprintMemberPublicJwk({ ...publicJwk, key_ops: [...(publicJwk.key_ops || [])].reverse() });
assert.match(fingerprintA, /^[0-9a-f]{64}$/);
assert.equal(fingerprintA, fingerprintB, 'fingerprint must be canonical for key_ops ordering');
assert.notEqual(
  fingerprintA,
  await fingerprintMemberPublicJwk({ ...publicJwk, n: `${publicJwk.n}A` }),
  'different public key material must change the fingerprint'
);

const keyring = await readFile('js/confidential-keyring.js', 'utf8');
assert.match(keyring, /generateRecoverySecret/);
assert.match(keyring, /encryptMemberPrivateKeyBackup/);
assert.match(keyring, /recoverMemberPrivateKey/);
assert.match(keyring, /extractable:\s*false/);
assert.match(keyring, /docinspector_crypto_key_targets/);
assert.match(keyring, /docinspector_initialize_workspace_crypto/);
assert.match(keyring, /unlocked\.bytes\.fill\(0\)/);
assert.doesNotMatch(keyring, /localStorage\.setItem\([^\n]*Recovery|sessionStorage\.setItem\([^\n]*Recovery/i);
assert.doesNotMatch(keyring, /service[_-]?role/i);

const migration = await readFile('supabase/migrations/20260820192916_fix_confidential_recovery_and_key_targets.sql', 'utf8');
assert.match(migration, /octet_length\(hkdf_salt\) = 16/);
assert.match(migration, /docinspector_crypto_key_targets/);
assert.match(migration, /docinspector_initialize_workspace_crypto/);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = ''/);
assert.match(migration, /revoke all on function public\.docinspector_crypto_key_targets\(uuid\) from public, anon/);
assert.match(migration, /grant execute on function public\.docinspector_crypto_key_targets\(uuid\) to authenticated/);
assert.match(migration, /grant execute on function public\.docinspector_initialize_workspace_crypto\(uuid, integer, bytea\) to authenticated/);
assert.match(migration, /m\.role = 'ADMIN'/);
assert.match(migration, /m\.active/);
assert.match(migration, /drop policy if exists docinspector_member_key_backups_update_own/);

secret.fill(0);
console.log('Confidential key provisioning and recovery regression checks passed.');
