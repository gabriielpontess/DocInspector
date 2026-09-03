# Settings/admin release checklist

1. Run deterministic checks.
2. Run full Chromium + WebKit browser gate and inspect logs/artifact.
3. Confirm Netlify Deploy Preview on exact HEAD.
4. Apply access-request schema migration, then administrator-only membership migration.
5. Deploy authenticated `docinspector-user-admin` and public validated `docinspector-access-request` Edge Functions.
6. Verify schema, function versions and Edge logs.
7. Merge exact validated HEAD to `main` and verify production deploy.
8. Never merge integration-only PR #73.
