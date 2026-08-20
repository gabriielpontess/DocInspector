# Authentication Model Convergence Plan

Date: 2026-08-20
Branch: `fix/auth-model-convergence-plan`
Status: architecture/transition plan only; no production migration applied

## Objective

Converge DocInspector from the legacy workspace-secret authorization model (`sky17_*`) to Supabase Auth + explicit workspace membership (`auth.users`, `docinspector_profiles`, `docinspector_workspace_members`) without breaking offline-first installations or copying/re-keying inspection data unnecessarily.

This document defines the transition. It does **not** revoke legacy access, change production schema, migrate users, rotate workspace secrets, or alter existing inspections in this PR.

## Current state

Two authorization planes coexist over largely the same domain data:

### Legacy plane

Legacy installations use:

- a workspace UUID;
- a high-entropy workspace secret stored locally;
- public `sky17_*` RPCs callable through the `anon` role;
- hash comparison against `sky17_workspaces.secret_hash`.

This model has no `auth.users` identity and therefore cannot express per-person roles or clean member revocation.

### Authenticated plane

The newer model uses:

- Supabase Auth (`auth.users`);
- `docinspector_profiles`;
- `docinspector_workspace_members` with role and active state;
- authenticated `docinspector_*` RPCs and RLS tied to `auth.uid()` + membership.

The authenticated RPCs already read/write the existing `sky17_inspections` and `sky17_deletions` data. The convergence problem is therefore primarily **identity and authorization**, not data relocation.

At the time of this audit, production contains 12 legacy workspaces, but only 1 workspace has an active Auth membership; 11 remain legacy-only. A global cutover would therefore strand legitimate installations.

## Guiding principles

1. Preserve data and workspace identity. Existing workspace UUIDs remain authoritative.
2. Do not copy inspections merely to move between auth models.
3. Legacy-only devices must continue syncing until their workspace is explicitly adopted.
4. Migration is per-workspace, observable and reversible before global cutover.
5. New privileged authorization must be based on Auth membership, never on client-editable metadata.
6. The workspace secret is transitional proof/compatibility material, not the future long-term user identity.
7. Legacy RPC hardening (rate limiting) and auth convergence are separate PRs and deployments.

## Phase 0 — Coexistence and hardening

Keep both authorization planes operational.

Required conditions:

- authenticated `docinspector_*` access remains protected by membership/RLS;
- legacy `sky17_*` continues to support existing installations;
- legacy secret brute-force/abuse mitigation is introduced independently after its design is approved;
- access-request/onboarding features may create/invite Auth users and memberships but do not silently disable legacy sync.

No workspace is considered migrated merely because one Auth member exists.

## Phase 1 — Explicit workspace adoption

Introduce an authenticated ADMIN-only adoption flow in a future implementation PR.

Conceptual flow:

1. User signs in with Supabase Auth.
2. User selects/adopts an existing legacy workspace.
3. The client proves possession of the existing workspace secret once through a dedicated migration/adoption boundary.
4. Server validates the secret against the existing workspace without exposing the stored hash.
5. On success, the authenticated user receives an active ADMIN membership for the **same workspace UUID**.
6. An auditable adoption event records who adopted the workspace and when.

The adoption operation must be idempotent and must not create a second workspace or copy inspections.

The plaintext workspace secret must never be persisted server-side as part of the adoption record.

## Phase 2 — Gradual device migration

Once a workspace has at least one recovery-capable ADMIN membership, migrate devices from legacy RPCs to authenticated `docinspector_*` RPCs progressively.

Each device should:

- keep its local IndexedDB/offline queues intact;
- authenticate with Supabase Auth;
- resolve its membership for the existing workspace UUID;
- switch remote operations to authenticated RPCs without rebuilding local inspection data;
- verify pull/upsert/delete and evidence access before marking the device migrated.

During this phase, legacy and authenticated devices may coexist in one workspace against the same underlying inspection/deletion records.

## Phase 3 — Per-workspace legacy-disable flag

Only after a workspace has demonstrated stable Auth-based operation should it become eligible to disable legacy secret access.

A future migration may introduce an explicit per-workspace state such as `legacy_sync_enabled` or a separate migration-state table. Exact schema belongs in a later implementation design, not this document.

A workspace may set legacy access to disabled only when all of the following are true:

- at least one active ADMIN exists;
- account recovery for that ADMIN has been smoke-tested;
- known active devices use Auth-based synchronization;
- pending offline changes have been reconciled;
- a defined observation window shows no required legacy RPC traffic for that workspace;
- rollback steps have been tested.

When disabled for a workspace, legacy RPCs must fail closed for that workspace while authenticated RPCs continue normally.

## Phase 4 — Global legacy RPC revocation

Global `anon EXECUTE` revocation for the legacy `sky17_*` RPCs occurs only after every relevant production workspace has either:

- completed Auth adoption and per-workspace legacy disablement; or
- been explicitly retired/archived through a separate governance decision.

Before global revocation:

- custom Auth domain/redirect behavior must be homologated;
- SMTP/recovery must be operational;
- access-request/admin onboarding must be stable in production;
- recovery from lost devices/admin sessions must be proven;
- telemetry must show no required legacy traffic during an agreed observation window;
- rollback must be rehearsed.

The global revocation should be its own migration/PR.

## Phase 5 — Secret retirement

`secret_hash` removal is **not** part of the initial cutover.

Retain the hash during a reversible post-cutover window so an authorized rollback can restore legacy compatibility if necessary. Only after the rollback window expires and telemetry confirms no dependency should removal/archival of secret material be considered in another migration.

Deleting `secret_hash` early would unnecessarily convert a reversible authorization cutover into an irreversible one.

## Behavior for legacy-only installations during the transition

Legacy-only installations continue working without being forced to create an Auth session until their workspace is explicitly adopted and migrated.

They retain:

- local offline inspection data;
- current workspace UUID;
- current sync secret;
- existing RPC contract during the coexistence window.

A user must never lose access solely because another workspace has migrated or because the authenticated feature set expands.

When a workspace eventually disables legacy sync, that decision must be visible to its administrators and should happen only after all relevant devices are accounted for.

## Recovery and break-glass considerations

Before per-workspace legacy disablement, at least one Auth-based recovery path must exist. Recommended minimum:

- two ADMIN memberships where operationally possible, or one ADMIN plus a tested administrative recovery procedure;
- verified Auth recovery email delivery;
- documented procedure for deactivating a lost member/device without deleting workspace data;
- no reliance on the old workspace secret as the sole recovery mechanism after legacy disablement.

A future cryptographic-document feature may introduce member/device key material; that recovery design must build on Auth membership but remain separate from the legacy workspace-secret transition.

## Observability needed for safe cutover

Future implementation should make migration state measurable without logging secrets:

- last successful legacy RPC use by workspace;
- last successful authenticated RPC use by workspace;
- count of active memberships by role;
- known migrated device identifiers where privacy policy allows;
- pending/error state relevant to offline synchronization.

Telemetry must not include plaintext workspace secrets or inspection payloads.

## Rollback strategy

### Before per-workspace legacy disablement

No rollback is normally required because both models coexist.

### After per-workspace disablement

Rollback is to re-enable legacy access for the affected workspace while retaining Auth memberships. No inspection/deletion data is reverted or copied.

### After global anon revocation

If the secret hash has deliberately been retained, rollback can restore the previous function grants/legacy compatibility migration while Auth remains active. This is why secret retirement is deferred to a later phase.

### After secret retirement

Rollback to secret-based auth would require a new secret provisioning process and is materially more disruptive. Secret retirement therefore requires its own explicit approval and backup/recovery review.

## Implementation sequencing / PR boundaries

Keep each change small and auditable:

1. Legacy RPC rate-limit hardening — separate migration/PR.
2. Workspace adoption mechanism — separate feature/migration PR.
3. Device/client migration to authenticated RPCs — separate feature PR(s).
4. Per-workspace legacy-disable state — separate migration/PR.
5. Global legacy RPC grant revocation — separate migration/PR.
6. Secret-hash retirement — separate, final migration/PR after a reversible observation window.

Do not combine these steps into one release.

## Acceptance gates for convergence completion

Convergence is complete only when:

- all retained workspaces have Auth memberships and recovery coverage;
- all supported clients use authenticated RPCs;
- no required legacy-only installations remain;
- offline queues survive migration and reconnect tests;
- per-workspace disablement has been exercised successfully;
- Auth domain/redirect and SMTP recovery are homologated;
- legacy usage telemetry is zero for the agreed window;
- `anon` can no longer execute the retired legacy RPC surface;
- rollback evidence is recorded for the cutover migration.

## References

- Supabase Data API security: https://supabase.com/docs/guides/api/securing-your-api
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase RBAC/custom claims guidance: https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
- Supabase Auth production checklist: https://supabase.com/docs/guides/deployment/going-into-prod
