import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { processPendingDeletions } from '../js/sync-delete-queue.js';

const attempted = [];
const secondFailure = new Error('transient delete failure');
const result = await processPendingDeletions(['inspection-1', 'inspection-2', 'inspection-3'], async id => {
  attempted.push(id);
  if (id === 'inspection-2') throw secondFailure;
});

assert.deepEqual(attempted, ['inspection-1', 'inspection-2', 'inspection-3'], 'the batch must keep processing after one deletion fails');
assert.deepEqual(result.remaining, ['inspection-2'], 'only failed deletions must remain queued');
assert.equal(result.firstError, secondFailure, 'the first deletion failure must still be reported after the batch finishes');

const successful = await processPendingDeletions(['inspection-4', 'inspection-5'], async () => {});
assert.deepEqual(successful.remaining, [], 'a successful batch must leave no pending ids');
assert.equal(successful.firstError, null, 'a successful batch must not synthesize an error');

const syncAuth = await readFile('js/sync-auth.js', 'utf8');
assert.match(syncAuth, /processPendingDeletions\(pending,/);
assert.match(syncAuth, /if \(remaining\.length\) await setSyncMeta\(DELETIONS_KEY, remaining\);\s*else await deleteSyncMeta\(DELETIONS_KEY\);\s*\n\s*if \(firstError\) throw firstError;/s, 'queue progress must be persisted before the sync error is propagated');

console.log('Pending deletion partial-failure regression checks passed.');
