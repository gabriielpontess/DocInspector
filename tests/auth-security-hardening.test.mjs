import assert from 'node:assert/strict';
import fs from 'node:fs';

const auth = fs.readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../js/auth-entry.js', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../js/sync-auth.js', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../js/permissions.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260817190402_close_legacy_touch_helper_execution.sql', import.meta.url), 'utf8');

// Recovery must use the official client flow and preserve safe diagnostics.
assert.match(auth, /resetPasswordForEmail/);
assert.match(auth, /detectSessionInUrl:\s*true/);
assert.match(auth, /status === 429/);
assert.match(auth, /rate_limit/);
assert.match(auth, /updateUser\(\{ password \}\)/);
assert.doesNotMatch(auth, /service_role|sb_secret_/i);

// Recovery callbacks must be intercepted before normal app bootstrap.
assert.match(entry, /isPasswordRecoveryUrl\(\)/);
assert.match(entry, /PASSWORD_RECOVERY/);
assert.match(entry, /renderPasswordRecovery\(\)/);
assert.match(entry, /waitForRecoverySession\(\)/);

// Authenticated sync cannot send the legacy shared secret.
assert.match(sync, /docinspector_pull_inspections/);
assert.match(sync, /docinspector_pull_deletions/);
assert.match(sync, /docinspector_upsert_inspection/);
assert.match(sync, /docinspector_delete_inspection/);
assert.doesNotMatch(sync, /p_secret\s*:/);
assert.doesNotMatch(sync, /syncKey\s*:/);
assert.doesNotMatch(sync, /x-docinspector-secret/);
assert.match(sync, /AUTH_WORKSPACE_BINDING_KEY/);
assert.match(sync, /AUTH_LOCAL_INSPECTION_QUARANTINE_KEY/);
assert.match(sync, /allowedInspectionIds/);

// User management is an Admin-only client capability; the server remains authoritative.
assert.match(permissions, /CAPABILITY\.MANAGE_USERS/);
assert.match(permissions, /capability !== CAPABILITY\.MANAGE_USERS/);

// Trigger helpers must not remain callable by client roles.
assert.match(migration, /revoke execute on function public\.sky17_touch_updated_at\(\) from public, anon, authenticated;/i);

console.log('Auth security hardening checks passed.');
