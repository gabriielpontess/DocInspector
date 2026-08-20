import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  'supabase/migrations/20260820172000_add_confidential_pdf_crypto_metadata.sql',
  'utf8'
);

for (const table of [
  'docinspector_member_public_keys',
  'docinspector_member_key_backups',
  'docinspector_workspace_crypto_keys',
  'docinspector_workspace_key_envelopes',
  'docinspector_project_documents'
]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`, 'i'));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'));
}

assert.match(migration, /RSA-OAEP-3072-SHA256/);
assert.match(migration, /not \(public_jwk \?\| array\['d','p','q','dp','dq','qi'\]\)/i);
assert.match(migration, /encrypted_private_key bytea not null/i);
assert.match(migration, /hkdf_salt bytea not null/i);
assert.match(migration, /octet_length\(iv\) = 12/i);
assert.doesNotMatch(migration, /\bprivate_key\s+(?:text|jsonb|bytea)/i);
assert.doesNotMatch(migration, /\bworkspace_key\s+(?:text|jsonb|bytea)/i);
assert.doesNotMatch(migration, /\bfile_key\s+(?:text|jsonb|bytea)/i);

assert.match(migration, /status in \('ROTATING','ACTIVE','RETIRED'\)/i);
assert.match(migration, /where status = 'ACTIVE'/i);
assert.match(migration, /member_user_id = \(select auth\.uid\(\)\)/i);
assert.match(migration, /admin_member\.role = 'ADMIN'/i);
assert.match(migration, /target_member\.active/i);

assert.match(migration, /docinspector_project_documents_select_member/i);
assert.match(migration, /m\.role in \('ADMIN','INSPECTOR'\)/i);
assert.match(migration, /plaintext_size between 1 and 20971520/i);
assert.match(migration, /ciphertext_size <= 52428800/i);
assert.match(migration, /crypto_version = 'DIPDF1'/i);

for (const table of [
  'docinspector_member_public_keys',
  'docinspector_member_key_backups',
  'docinspector_workspace_crypto_keys',
  'docinspector_workspace_key_envelopes',
  'docinspector_project_documents'
]) {
  assert.match(migration, new RegExp(`grant [^;]+ on table public\\.${table} to authenticated`, 'i'));
}

console.log('Confidential PDF crypto metadata/RLS regression checks passed.');
