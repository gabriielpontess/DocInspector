# Confidential PDF crypto metadata — migration and rollback

Migration applied in production: `20260820173313_add_confidential_pdf_crypto_metadata.sql`

Follow-up FK index migration applied in production: `20260820173433_index_confidential_pdf_crypto_foreign_keys.sql`

## Forward compatibility

This migration adds only new E2EE metadata tables, indexes, constraints, grants, RLS policies, and two `updated_at` triggers. It does not modify legacy `sky17_*` inspection data, Auth memberships, evidence objects, or existing Storage policies.

The client must treat a workspace as **crypto-not-ready** until an active member key and a workspace-key envelope exist. Membership alone must never imply possession of plaintext key material.

## Production verification

After applying the migration:

1. Confirm all five tables exist and have RLS enabled.
2. Confirm `anon` has no privileges on the new tables.
3. Confirm authenticated members can see only rows authorized by workspace membership and that member key backups are visible only to their owner.
4. Confirm ADMIN-only workspace key version/envelope writes and ADMIN/INSPECTOR document metadata writes.
5. Run Supabase security and performance advisors.
6. Do not create the confidential Storage bucket until the Phase 3 transport PR is ready.

## Rollback

Rollback is non-destructive by default:

1. Disable confidential-PDF UI/transport clients first.
2. Revoke authenticated grants on the five new tables to freeze access.
3. Preserve all encrypted metadata and key envelopes for recovery.
4. Do **not** drop tables while any encrypted document metadata/key envelope exists.

A destructive rollback (dropping the five tables) is allowed only when they are empty and requires an explicit data-loss decision. Existing inspections, legacy sync, evidence storage, profiles, memberships, and access requests are not part of this migration and must remain untouched.
