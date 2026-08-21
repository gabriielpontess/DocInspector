import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260821111500_add_confidential_pdf_document_linking.sql';
const migration = await readFile(migrationPath, 'utf8');

// document_id is deliberately nullable and semantic-only while inspection documents live in JSONB.
assert.match(
  migration,
  /alter table public\.docinspector_project_documents\s+add column document_id uuid null;/i
);
assert.doesNotMatch(migration, /document_id\s+uuid\s+not\s+null/i);
assert.doesNotMatch(migration, /foreign key\s*\([^)]*document_id/i);
assert.doesNotMatch(migration, /references\s+public\.[^(]+\([^)]*document_id/i);

// Detail-page lookup must be covered by the approved partial index.
assert.match(
  migration,
  /create index docinspector_project_documents_document_idx\s+on public\.docinspector_project_documents\s*\(\s*workspace_id,\s*inspection_id,\s*document_id,\s*created_at\s*\)\s*where status <> 'DELETED'\s+and document_id is not null;/is
);

// Quantity limit has one runtime source of truth. Raising it later is DML/configuration, not DDL.
assert.match(migration, /create table public\.docinspector_confidential_pdf_config/i);
assert.match(migration, /max_files_per_inspection integer not null/i);
assert.match(migration, /values \('global', 10\)/i);
assert.match(migration, /grant select on table public\.docinspector_confidential_pdf_config to authenticated/i);
assert.match(migration, /select c\.max_files_per_inspection\s+into v_max_files/is);
assert.match(migration, /if v_count >= v_max_files then/i);
assert.doesNotMatch(migration, /if v_count >= 10 then/i);

// Existing pilot caps remain unchanged.
assert.match(migration, /209715200/);
assert.match(migration, /200 MiB/i);

// This migration must not mutate E2EE payload/key columns or Storage objects.
for (const forbidden of [
  'metadata_ciphertext',
  'metadata_iv',
  'wrapped_file_key',
  'workspace_key_version',
  'ciphertext_sha256',
  'storage.objects',
  'docinspector-confidential-pdfs'
]) {
  assert.doesNotMatch(migration, new RegExp(forbidden.replace('.', '\\.'), 'i'));
}

console.log('Confidential PDF document-linking schema regression checks passed.');
