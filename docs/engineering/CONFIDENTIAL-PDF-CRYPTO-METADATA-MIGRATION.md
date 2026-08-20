# Confidential PDF crypto metadata — migration and rollback

Production migrations:

- `20260820173313_add_confidential_pdf_crypto_metadata.sql`
- `20260820173433_index_confidential_pdf_crypto_foreign_keys.sql`

## Forward compatibility

The metadata migration adds only E2EE metadata tables, indexes, constraints, grants, RLS policies, and two `updated_at` triggers. It does not modify legacy `sky17_*` inspection data, Auth memberships, evidence objects, or existing Storage policies. The follow-up migration adds covering indexes for the foreign keys reported by the Supabase performance advisor.

The client must treat a workspace as **crypto-not-ready** until an active member key and a workspace-key envelope exist. Membership alone must never imply possession of plaintext key material.

## Production verification

Production was verified after applying both migrations:

1. All five E2EE metadata tables exist with RLS enabled.
2. The tables were empty immediately after creation, so no existing inspection/evidence content was migrated.
3. The post-DDL security advisor introduced no new E2EE warning; the pre-existing legacy `sky17_*` and leaked-password warnings remain separate debts.
4. The follow-up FK indexes cleared the new unindexed-foreign-key advisor findings; unused-index INFO entries are expected while the new tables are empty.
5. The confidential Storage bucket belongs to Phase 3 and is not created by these migrations.

## Rollback

Rollback is non-destructive by default:

1. Disable confidential-PDF UI/transport clients first.
2. Revoke authenticated grants on the five new tables to freeze access.
3. Preserve all encrypted metadata and key envelopes for recovery.
4. Do **not** drop tables while any encrypted document metadata/key envelope exists.

A destructive rollback (dropping the five tables) is allowed only when they are empty and requires an explicit data-loss decision. Existing inspections, legacy sync, evidence storage, profiles, memberships, and access requests are not part of this migration and must remain untouched.
