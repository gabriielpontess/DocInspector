# Confidential E2EE Phase 7D — final hardening and release gate

This phase closes the remaining application-level bypass around E2EE member removal and adds browser evidence for offline key recovery and logout cleanup.

## Database hardening

Once a workspace has any `docinspector_workspace_crypto_keys` row, an active membership may no longer be set to inactive by a generic table update. The trigger `private.docinspector_guard_e2ee_member_deactivation()` requires a transaction-local guard containing the exact `<workspace_id>:<user_id>` pair.

Only `public.docinspector_begin_member_removal_rotation(...)` sets that guard immediately before the membership deactivation. The RPC still validates authenticated active ADMIN membership, the active source WK, the caller envelope, the caller active MEK, upload quiescence and document key-version consistency before entering the guarded section.

This is defense in depth: the UI already routes removal through the rotation flow, but the database now rejects a future service-role/Edge Function update that attempts to bypass it.

## Browser hardening evidence

The Phase 7D Playwright lifecycle test verifies on both Chromium and WebKit that:

- a non-extractable RSA-OAEP private MEK can survive IndexedDB structured clone;
- only the RSA-wrapped WK envelope is persisted for offline use;
- after network loss, the envelope is unwrapped locally and produces the same AES-GCM result as the original WK while the imported WK remains non-extractable;
- explicit logout clears the local MEK store, cached WK-envelope store and confidential ciphertext store;
- a SUPERVISOR authenticated runtime hides management navigation.

The browser harness uses deterministic local Auth/Supabase stubs to exercise the real application modules without storing credentials in the repository or exposing a self-hosted runner to fork-controlled secrets.

## Production validation

After deployment, validate the guard inside a transaction that is rolled back: insert temporary crypto-key metadata for a workspace that has no E2EE data, attempt a direct `active=true -> false` membership update, assert SQLSTATE `55000`, then roll the transaction back. Do not perform a real member removal merely to test the trigger.

The production workspace currently has only one active ADMIN and no E2EE key/document rows. Therefore a credentialed real multi-user login/rotation smoke cannot be executed safely without adding test identities or receiving dedicated test credentials. The release gate must record that limitation explicitly rather than silently treating an auth-bypass harness as real multi-user evidence.

## Rollback

The safe rollback is to drop `docinspector_workspace_members_guard_e2ee_deactivation` and then drop `private.docinspector_guard_e2ee_member_deactivation()`. The extra transaction-local `set_config` calls in the rotation RPC are harmless if the trigger is absent and may remain in place.

Do not roll back by weakening RLS, reactivating a removed member, deleting WK versions/envelopes, or rewriting encrypted PDF objects.
