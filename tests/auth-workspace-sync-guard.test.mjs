import assert from 'node:assert/strict';
import fs from 'node:fs';

const normalizeNewlines = (text) => text.replace(/\r\n/g, '\n');
const sync = normalizeNewlines(fs.readFileSync(new URL('../js/sync-auth.js', import.meta.url), 'utf8'));
const sw = normalizeNewlines(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'));

assert.match(sync, /AUTH_WORKSPACE_BINDING_KEY\s*=\s*'auth-workspace-binding-v1'/);
assert.match(sync, /AUTH_QUARANTINE_KEY\s*=\s*'auth-workspace-quarantine-v1'/);
assert.match(sync, /AUTH_LOCAL_INSPECTION_QUARANTINE_KEY\s*=\s*'auth-local-inspection-quarantine-v1'/);
assert.match(sync, /ensureWorkspaceBinding\(config\.workspaceId\)/);
assert.match(sync, /quarantinePendingQueues/);
assert.match(sync, /quarantineLocalInspection/);
assert.match(sync, /setSyncMeta\(AUTH_LOCAL_INSPECTION_QUARANTINE_KEY/);
assert.match(sync, /deleteInspection\(inspection\.id\)/);
assert.match(sync, /deleteSyncMeta\(DELETIONS_KEY\)/);
assert.match(sync, /deleteSyncMeta\(EVIDENCE_DELETIONS_KEY\)/);
assert.match(sync, /localOnlyBelongsToCurrentBinding\(local, binding\)/);
assert.match(sync, /createdAt >= boundAt/);
assert.match(sync, /quarantinedLocalCount \+= 1/);
assert.match(sync, /allowedInspectionIds\.has\(inspection\.id\)/);
assert.match(sync, /Sincronizado · \$\{quarantinedLocalCount\} registro\(s\) local\(is\) isolado\(s\)/);
assert.match(sw, /const VERSION = '0\.9\.42';/);

const cycle = sync.match(/async function performSyncCycle\(\) \{[\s\S]*?\n\}/)?.[0] || '';
const refreshIndex = cycle.indexOf('await refreshAuthContext()');
const clientIndex = cycle.indexOf('await ensureAuthenticatedClient()');
assert.ok(refreshIndex >= 0 && clientIndex >= 0 && refreshIndex < clientIndex, 'online sync must revalidate membership before capturing workspace config');

const branchMatch = sync.match(/if \(local && !remoteInspection\) \{[\s\S]*?\n      \}\n      const merged/);
assert.ok(branchMatch, 'local-only branch must remain explicit');
const branch = branchMatch[0];
assert.match(branch, /!localOnlyBelongsToCurrentBinding\(local, binding\)/, 'local-only inspection must be rejected unless it belongs to the current binding');
assert.match(branch, /await quarantineLocalInspection\(local, config\.workspaceId\)/, 'stale local-only inspection must be preserved in quarantine before removal');
assert.match(branch, /continue;[\s\S]*await upsertRemote\(remote, config, local\)/, 'remote upsert must occur only after the guard allows the record');

console.log('Authenticated workspace sync isolation checks passed.');
