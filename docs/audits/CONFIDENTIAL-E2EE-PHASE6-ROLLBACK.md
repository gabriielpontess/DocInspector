# Confidential E2EE Phase 6 — deployment and rollback

Phase 6 implements member removal as an online security event followed by resumable Workspace Key (WK) rotation. The removed membership is deactivated before the next WK version is created. The browser then distributes the new WK only as RSA-OAEP ciphertext and rewraps each existing FEK locally from the old WK to the new WK. The `.dipdf` Storage object is not changed or re-uploaded.

## Production migration

Production registered this change as `20260820195245_add_confidential_member_removal_rotation`. The repository migration filename must remain aligned with that exact version so future migration tooling does not attempt to replay the DDL.

The migration creates only rotation metadata/RPC infrastructure. No real member removal or WK rotation was executed during deployment; `private.docinspector_workspace_key_rotations` remained empty after verification.

The Supabase Security Advisor reports `authenticated_security_definer_function_executable` for the four Phase 6 RPCs. These warnings are expected and reviewed: signed-in clients intentionally invoke the functions, while every RPC performs an explicit `auth.uid()` check, requires active ADMIN membership in the requested workspace, uses an empty `search_path`, is revoked from PUBLIC/anon, and grants EXECUTE only to `authenticated`. Any future modification to those authorization checks is security-sensitive and requires re-running the advisor.

## Rotation invariants

- only an active ADMIN may start, resume or finish a rotation;
- an ADMIN cannot remove itself through this flow because the caller must remain able to finish the rotation;
- the target membership is deactivated first, so RLS blocks future metadata/Storage access even if the later rotation steps are interrupted;
- only one `ROTATING` WK may exist per workspace;
- new confidential uploads are blocked while a WK is `ROTATING` so no new FEK can be introduced under an ambiguous version;
- remaining active members with an active MEK must receive the new WK envelope before finalization;
- existing PDFs keep the same ciphertext object; only `wrapped_file_key` and `workspace_key_version` move to the new WK version;
- rewrap RPC calls are idempotent: a retry of a document already moved to the new version does not increment progress again;
- finalization retires the old WK only after every active PDF references the new version and every key-ready active member has the new envelope.

## Interrupted rotation

An interrupted rotation is a supported state, not a rollback trigger. The old WK remains `ACTIVE`, the new WK remains `ROTATING`, uploads stay blocked, and the removed member remains inactive. An authorized ADMIN that has local access to both WK envelopes can resume the operation later. Documents already rewrapped remain valid and are skipped idempotently on resume.

## Production rollback

Before any rotation has started, application rollback is non-destructive: hide/disable the member-removal action and leave the Phase 6 table/RPCs inert.

After a rotation has started, **do not reactivate the removed member, delete the new key version, restore old FEK envelopes, or drop rotation metadata as a normal rollback**. Doing so could reintroduce access for the removed account or strand files across key versions. The safe recovery action is to preserve the data and resume/complete the rotation with an authorized ADMIN client.

After a rotation has completed, preserve both retired and active WK metadata/envelopes and the current FEK envelopes. The PDF ciphertext objects themselves did not change, so there is no Storage rollback to perform.

Dropping rotation metadata, key versions, envelopes, or reactivating removed memberships after real E2EE data exists is a security-sensitive/destructive action and requires a separate explicit retention/recovery decision.

The server never receives WK plaintext, FEK plaintext, MEK private material, Recovery Secrets or PDF plaintext in this phase.
