# Engineering Tracker Rollback

The Engineering tracker introduces no database migration and no new production table.

Rollback is code-only: revert the tracker PR/commits and advance the Service Worker cache identity again if the app shell changes during the revert.

Engineering state is stored as `document.engineering.updated` entries inside the existing inspection `documentAudit` payload. Reverting the UI does not require deleting those audit events. They should be left intact so a later corrected version can read the historical records without data loss.

Do not purge or rewrite existing inspection audit events as part of rollback.
