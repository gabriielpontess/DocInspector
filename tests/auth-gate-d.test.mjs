import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, entry, context, sync, permissionsUi, sw, config] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('js/auth-entry.js', 'utf8'),
  readFile('js/auth-context.js', 'utf8'),
  readFile('js/sync-auth.js', 'utf8'),
  readFile('js/permission-ui.js', 'utf8'),
  readFile('sw.js', 'utf8'),
  readFile('js/auth-config.js', 'utf8')
]);

assert.match(index, /type="module" src="js\/auth-entry\.js"/i);
assert.doesNotMatch(index, /type="module" src="js\/app\.js"/i);
assert.match(index, /"\.\/js\/sync\.js"\s*:\s*"\.\/js\/sync-auth\.js"/i);
assert.match(index, /href="auth\.css"/i);

assert.match(entry, /authRolloutEnabled\(\)/);
assert.match(entry, /resolveAuthContext\(\{ allowOffline: true \}\)/);
assert.match(entry, /signInWithEmailPassword/);
assert.match(entry, /import\('\.\/app\.js'\)/);
assert.match(entry, /import\('\.\/permission-ui\.js'\)/);

assert.match(context, /rpc\('docinspector_my_workspaces'\)/);
assert.match(context, /docinspector_profiles/);
assert.match(context, /loadOfflineContext/);
assert.match(context, /cached\.userId !== session\.user\.id/);
assert.doesNotMatch(context, /user_metadata|raw_user_meta_data/i);

for (const rpc of [
  'docinspector_pull_inspections',
  'docinspector_pull_deletions',
  'docinspector_upsert_inspection',
  'docinspector_delete_inspection'
]) {
  assert.match(sync, new RegExp(rpc));
}
assert.match(sync, /getAuthClient\(\)/);
assert.doesNotMatch(sync, /p_secret\s*:/);
assert.match(sync, /if \(!authMode\(\)\) return legacy\./);
assert.match(sync, /\.\/sync\.js\?legacy=1/, 'adapter autenticado deve manter acesso explícito ao caminho legado somente para rollout');

assert.match(permissionsUi, /CAPABILITY\.MANAGE_INSPECTIONS/);
assert.match(permissionsUi, /CAPABILITY\.VERIFY_DOCUMENTS/);
assert.match(permissionsUi, /CAPABILITY\.EXPORT_DATA/);
assert.match(permissionsUi, /signOutCurrentSession/);

for (const asset of ['auth.css', 'js/auth-entry.js', 'js/auth-context.js', 'js/sync-auth.js', 'js/permission-ui.js', 'js/sync.js?legacy=1']) {
  assert.ok(sw.includes(asset), `service worker must cache ${asset}`);
}

assert.match(config, /enabled:\s*false/, 'Gate D must remain staged until an administrator exists.');
assert.doesNotMatch(`${entry}\n${context}\n${sync}`, /service_role|sb_secret_/i);

console.log('Auth Gate D staged client checks passed.');
