# Confidential E2EE Phase 5 — deployment and rollback

Phase 5 provisions a member RSA-OAEP MEK in the browser, stores only the public JWK and an AES-GCM encrypted private-key backup in Supabase, persists a non-extractable normal-use private `CryptoKey` locally in IndexedDB, and displays a 256-bit Recovery Secret exactly once to the user. An ADMIN may initialize the first versioned Workspace Key and grant the active WK to key-ready active members by wrapping it locally to each member public key.

## Production migration

The migration changes the existing backup salt constraint from 32 bytes to 16 bytes. This is not a cryptographic downgrade: the approved Phase 1 implementation has always generated a random 16-byte HKDF salt (`RECOVERY_SALT_BYTES = 16`); the original table constraint was inconsistent and would reject every real recovery backup. At deployment time all confidential crypto metadata tables are still empty, so the constraint correction does not rewrite user data.

The migration also hardens backup UPDATE so a deactivated member cannot change its backup and adds `public.docinspector_crypto_key_targets(uuid)`. The RPC is `SECURITY DEFINER` only because the normal membership RLS intentionally exposes each member only to themself. It has an explicit `auth.uid()` check, requires an active ADMIN membership in the requested workspace, uses an empty `search_path`, exposes only active member IDs/roles plus public-key material and envelope readiness, is revoked from PUBLIC/anon, and is executable only by `authenticated`.

Initial Workspace Key creation is performed by `public.docinspector_initialize_workspace_crypto(uuid, integer, bytea)`. The browser generates WK plaintext and RSA-wraps it to the ADMIN before calling the RPC. The function receives only ciphertext, verifies the caller is an active ADMIN with the referenced active public key, serializes concurrent initialization with a transaction advisory lock, and atomically creates both the active WK metadata row and the ADMIN envelope. The backend never receives WK plaintext.

The Supabase Security Advisor reports `authenticated_security_definer_function_executable` for these two RPCs. This is an expected, reviewed warning: signed-in clients are intentionally allowed to invoke them, while the functions themselves enforce the active ADMIN authorization boundary. `anon` has no EXECUTE privilege. Any future change to those internal checks must treat the advisor warning as security-sensitive rather than suppressing it.

## Rollback

Application rollback is non-destructive: disable the Phase 5 provisioning/grant UI and preserve all public keys, encrypted private-key backups, WK metadata and envelopes. The ADMIN helper RPCs can be dropped after the UI is disabled if necessary.

Do **not** blindly restore the old 32-byte salt constraint after any 16-byte recovery backup exists. That would make valid encrypted backups incompatible and can block recovery. The 32-byte constraint may only be restored if a verification query proves there are no Phase 5 backup rows. Otherwise keep the corrected 16-byte constraint while the application is rolled back/read-only.

No Recovery Secret, MEK private key, WK plaintext, service-role credential, or PDF plaintext is stored server-side by this phase.
