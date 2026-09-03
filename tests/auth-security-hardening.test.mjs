import assert from 'node:assert/strict';
import fs from 'node:fs';

const auth = fs.readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../js/auth-entry.js', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../js/sync-auth.js', import.meta.url), 'utf8');
const permissions = fs.readFileSync(new URL('../js/permissions.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260817190402_close_legacy_touch_helper_execution.sql', import.meta.url), 'utf8');
const recoveryTemplate = fs.readFileSync(new URL('../docs/supabase-recovery-email-template.md', import.meta.url), 'utf8');

// Recovery must use the official client flow and preserve safe diagnostics.
assert.match(auth, /resetPasswordForEmail/);
assert.match(auth, /detectSessionInUrl:\s*true/);
assert.match(auth, /status === 429/);
assert.match(auth, /rate_limit/);
assert.match(auth, /updateUser\(\{ password \}\)/);
assert.match(auth, /verifyRecoveryTokenHash/);
assert.match(auth, /verifyOtp\(\{ token_hash: token, type: 'recovery' \}\)/);
assert.doesNotMatch(auth, /service_role|sb_secret_/i);

// Recovery callbacks must be intercepted before normal app bootstrap, including error callbacks.
assert.match(entry, /isPasswordRecoveryUrl\(\)/);
assert.match(entry, /PASSWORD_RECOVERY/);
assert.match(entry, /renderPasswordRecovery\(\)/);
assert.match(entry, /waitForRecoverySession\(\)/);
assert.match(entry, /authCallbackErrorMessage/);
assert.match(entry, /otp_expired/);
assert.match(entry, /recoveryToken/);
assert.match(entry, /renderRecoveryLanding/);
assert.match(entry, /bindRecoveryLanding/);
assert.match(entry, /verifyRecoveryTokenHash\(tokenHash\)/);

// Scanner-safe email template must avoid direct ConfirmationURL consumption.
assert.match(recoveryTemplate, /recovery_token=\{\{ \.TokenHash \}\}/);
assert.doesNotMatch(recoveryTemplate, /href="\{\{ \.ConfirmationURL \}\}"/);
assert.match(recoveryTemplate, /verifyOtp\(\{ token_hash, type: 'recovery' \}\)/);

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

// Active workspace authorization exposes only Administrator; server-side checks remain authoritative.
assert.match(permissions, /ADMIN:\s*'ADMIN'/);
assert.match(permissions, /MANAGE_USERS:\s*'MANAGE_USERS'/);
assert.match(permissions, /const ADMIN_ACCESS = Object\.freeze\(Object\.values\(CAPABILITY\)\)/);
assert.doesNotMatch(permissions, /INSPECTOR|SUPERVISOR|FOREMAN/);

// Trigger helpers must not remain callable by client roles.
assert.match(migration, /revoke execute on function public\.sky17_touch_updated_at\(\) from public, anon, authenticated;/i);

console.log('Auth security hardening checks passed.');
