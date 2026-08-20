# Legacy RPC Rate-Limit Audit

Date: 2026-08-20
Branch: `fix/legacy-rpc-rate-limit-audit`
Status: diagnosis/design only; no production migration applied

## Scope

This audit covers the legacy anonymous RPC surface used by offline-first workspace synchronization:

- `sky17_verify_workspace(uuid, text)`
- `sky17_pull_inspections(uuid, text)`
- `sky17_pull_deletions(uuid, text)`
- `sky17_upsert_inspection(uuid, text, uuid, jsonb, text)`
- `sky17_delete_inspection(uuid, text, uuid, text)`

It intentionally does **not** change `sky17_has_workspace_access`, Storage authorization, the authenticated `docinspector_*` RPCs, or any production schema in this PR.

## Root cause

The five RPCs above are callable by the `anon` role and validate access by comparing a SHA-256 hash of the caller-provided workspace secret with `sky17_workspaces.secret_hash`. The secret itself is generated client-side from 32 cryptographically random bytes, so exhaustive brute-force of a correctly generated secret is not a realistic attack.

The security gap is an online abuse-control gap: there is currently no application-level throttle or progressive lockout for repeated invalid-secret attempts against these PostgREST RPC endpoints. The Supabase Auth rate limits documented for `/auth/v1/*` do not apply to Data API/PostgREST RPC calls. Supabase documents per-IP/per-user limits for the Data API as an additional application responsibility, including the option of a PostgREST pre-request function.

Current project inspection also found no `pgrst.db_pre_request` configured and no dedicated private rate-limit table/helper for this legacy RPC surface.

## Why a global request limiter is the wrong fit

DocInspector is offline-first and synchronizes by polling. Normal healthy operation can generate many `pull_inspections` and `pull_deletions` calls, especially when several devices reconnect after being offline. A blanket per-IP limit on all RPC calls would therefore risk blocking legitimate sync traffic behind a shared NAT and would violate the offline-first reliability requirement.

The mitigation must distinguish **invalid authentication attempts** from valid synchronization traffic.

## Recommended mitigation

Introduce a small DB-side guard used only by the five public legacy RPC entry points. The guard should record and throttle **failed workspace-secret validations by client IP**. Valid credentials should not consume the failure budget and should continue without artificial delay.

Recommended behavior:

1. Each legacy RPC performs its normal workspace-secret validation.
2. On invalid credentials, an internal helper reads the client IP from the trusted request context exposed by PostgREST and records the failure in a table located in a non-exposed/private schema.
3. The failure budget is evaluated in a rolling window. Repeated failures from the same IP return an HTTP 429-compatible PostgREST exception with `Retry-After` semantics.
4. Successful validation resets or ignores the failure state for the request; legitimate clients are not delayed because another device behind the same IP previously failed.
5. Old failure rows are expired automatically or opportunistically so the table remains bounded.
6. The implementation must avoid logging the plaintext workspace secret.

The first implementation should use conservative thresholds and be tested against reconnect bursts before promotion. Threshold values are operational policy and should be introduced in the implementation PR with regression tests rather than hard-coded in this design document.

## Why not an Edge Function first

Placing an Edge Function in front of the RPCs could provide strong per-IP throttling, but it would require changing the endpoint used by every legacy installation, adding another network hop and creating a larger migration/cutover surface. For a compatibility hardening step, the DB-side guard preserves the existing RPC contract and is therefore the smaller reversible change.

An Edge gateway remains a future option if broader WAF/CAPTCHA/device-attestation controls are required.

## Why not change `sky17_has_workspace_access`

`sky17_has_workspace_access` is a shared internal authorization primitive and is also used by the legacy Storage authorization path. Adding mutable rate-limit state there would unexpectedly couple unrelated reads/Storage checks to the throttle and would broaden the blast radius beyond the five RPCs under review.

The guard should therefore remain at the public legacy RPC boundary.

## Interaction with SECURITY DEFINER advisor warnings

This mitigation reduces brute-force/abuse risk but does not eliminate the Security Advisor warning that anonymous callers can execute `SECURITY DEFINER` legacy RPCs. That exposure is intentional during the compatibility window. The warning is retired only when the legacy anonymous surface is disabled as part of the authentication-model convergence plan.

## Data model constraints for the implementation PR

Any future migration should:

- create rate-limit state only in a private/non-exposed schema;
- expose no direct grants to `anon` or `authenticated` on the backing table;
- use an internal helper with a fixed/empty `search_path` and minimal privileges;
- avoid storing plaintext secrets, request bodies, inspection payloads, or unnecessary PII;
- index the lookup key/time window used by the throttle;
- keep retention bounded;
- preserve the current RPC signatures and return shapes;
- include deterministic tests for valid traffic, invalid bursts, expiry/recovery and shared-NAT behavior.

## Rollback plan

Rollback must be non-destructive to inspection/workspace data:

1. Restore the previous definitions of the five `sky17_*` RPCs without the rate-limit helper call.
2. Verify successful legacy pull/upsert/delete using an existing valid workspace secret.
3. Only after RPC compatibility is confirmed, remove the internal helper and private rate-limit table/indexes.
4. Reload the PostgREST schema/config cache only if required by the chosen implementation.

No rollback step may delete or rewrite `sky17_workspaces`, `sky17_inspections`, `sky17_deletions`, evidence objects, or local offline queues.

## Verification gates before any production migration

- migration exists in source control with explicit rollback notes;
- Security Advisor and relevant database advisors reviewed;
- automated tests prove valid sync is not rate-limited;
- automated tests prove repeated invalid secrets are throttled and recover after expiry;
- reconnect/burst test covers multiple devices behind one IP;
- smoke test covers legacy create/verify/pull/upsert/delete and Storage access;
- no change to authenticated `docinspector_*` flows;
- no change to `sky17_has_workspace_access`.

## References

- Supabase Auth rate limits: https://supabase.com/docs/guides/auth/rate-limits
- Supabase Data API security / pre-request enforcement: https://supabase.com/docs/guides/api/securing-your-api
- Supabase Production Checklist / abuse prevention: https://supabase.com/docs/guides/deployment/going-into-prod
