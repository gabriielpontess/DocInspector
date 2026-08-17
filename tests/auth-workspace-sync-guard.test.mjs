import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync = fs.readFileSync(new URL('../js/sync-auth.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

assert.match(sync, /AUTH_WORKSPACE_BINDING_KEY\s*=\s*'auth-workspace-binding-v1'/);
assert.match(sync, /AUTH_QUARANTINE_KEY\s*=\s*'auth-workspace-quarantine-v1'/);
assert.match(sync, /ensureWorkspaceBinding\(config\.workspaceId\)/);
assert.match(sync, /quarantinePendingQueues/);
assert.match(sync, /deleteSyncMeta\(DELETIONS_KEY\)/);
assert.match(sync, /deleteSyncMeta\(EVIDENCE_DELETIONS_KEY\)/);
assert.match(sync, /localOnlyBelongsToCurrentBinding\(local, binding\)/);
assert.match(sync, /createdAt >= boundAt/);
assert.match(sync, /quarantinedLocalCount \+= 1/);
assert.match(sync, /allowedInspectionIds\.has\(inspection\.id\)/);
assert.match(sync, /Sincronizado · \$\{quarantinedLocalCount\} registro\(s\) local\(is\) isolado\(s\)/);
assert.match(sw, /const VERSION = '0\.9\.31';/);

const unsafeLocalOnlyBranch = /if \(local && !remoteInspection\) \{[\s\S]{0,180}await upsertRemote\(remote, config, local\);/;
assert.match(sync, unsafeLocalOnlyBranch, 'local-only branch must remain explicit and guarded');
const branch = sync.match(unsafeLocalOnlyBranch)?.[0] || '';
assert.match(branch, /!localOnlyBelongsToCurrentBinding\(local, binding\)/, 'local-only inspection must be rejected unless it belongs to the current binding');

console.log('Authenticated workspace sync isolation checks passed.');
