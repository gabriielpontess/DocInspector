import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const access = await readFile('supabase/migrations/20260817163849_add_authenticated_inspection_and_storage_access.sql','utf8');
const legacy = await readFile('supabase/migrations/20260817163910_restrict_legacy_sync_to_anon_during_auth_rollout.sql','utf8');
const helpers = await readFile('supabase/migrations/20260817163946_close_internal_legacy_helpers_to_authenticated_clients.sql','utf8');

for (const table of ['sky17_inspections','sky17_deletions']) {
  assert.match(access, new RegExp(`grant select, insert, update, delete on table public\\.${table} to authenticated`, 'i'));
}
assert.match(access, /security invoker/gi);
assert.match(access, /m\.user_id\s*=\s*\(select auth\.uid\(\)\)/i);
assert.match(access, /m\.active/i);
assert.match(access, /m\.role in \('ADMIN','INSPECTOR'\)/i);
assert.match(access, /docinspector_pull_inspections/i);
assert.match(access, /docinspector_upsert_inspection/i);
assert.match(access, /docinspector_delete_inspection/i);
assert.match(access, /docinspector_evidence_authenticated_select/i);
assert.match(access, /docinspector_evidence_authenticated_insert/i);
assert.doesNotMatch(access, /security definer/i);

assert.match(legacy, /revoke execute on function public\.sky17_upsert_inspection[\s\S]*from authenticated/i);
assert.match(legacy, /create policy docinspector_evidence_select[\s\S]*to anon/i);
assert.doesNotMatch(legacy, /to anon, authenticated/i);
assert.match(helpers, /sky17_has_workspace_access[\s\S]*from anon, authenticated/i);
assert.match(helpers, /sky17_secret_hash[\s\S]*from anon, authenticated/i);

console.log('Auth/RBAC Gate C authorization checks passed.');