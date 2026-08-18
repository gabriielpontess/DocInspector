import assert from 'node:assert/strict';
import fs from 'node:fs';

const plan = fs.readFileSync(new URL('../supabase/plans/disable_legacy_anon_after_auth_cutover.sql', import.meta.url), 'utf8');

assert.match(plan, /APPLY ONLY AFTER authenticated field validation is complete/i);
assert.match(plan, /outside supabase\/migrations/i);
for (const fn of [
  'sky17_create_workspace',
  'sky17_verify_workspace',
  'sky17_pull_inspections',
  'sky17_pull_deletions',
  'sky17_upsert_inspection',
  'sky17_delete_inspection',
  'sky17_schema_version',
  'sky17_storage_object_allowed'
]) {
  assert.ok(plan.includes(`public.${fn}`), `${fn} must be disabled in the post-auth cutover plan`);
}
for (const policy of [
  'docinspector_evidence_select',
  'docinspector_evidence_insert',
  'docinspector_evidence_update',
  'docinspector_evidence_delete'
]) {
  assert.ok(plan.includes(policy), `${policy} must be removed in the post-auth cutover plan`);
}
assert.doesNotMatch(plan, /drop\s+table|delete\s+from|truncate/i, 'cutover plan must not destroy historical data');

console.log('Legacy authenticated cutover plan checks passed.');
