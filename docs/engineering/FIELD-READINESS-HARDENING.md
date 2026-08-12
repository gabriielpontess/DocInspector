# Field readiness hardening

## Data-safety invariant for inspection list refreshes

Updating the source spreadsheet of an existing inspection must never erase field work.

The refresh flow follows these rules:

1. Documents are matched first by normalized PW code and, only when unique, by their alphanumeric code identity.
2. A matched document keeps its existing DocInspector ID, field copies, photographic evidence references, comments, tombstones and verification history.
3. Spreadsheet-owned fields (PW code, description, list status and expected revision) may be refreshed from the new catalog.
4. A document that is new in the spreadsheet is added as pending.
5. A pending document that disappeared from the spreadsheet may be removed.
6. A reviewed document that disappeared from the spreadsheet is retained conservatively. Spreadsheet refresh must never be a destructive operation for reviewed field data.
7. A preview is shown before persistence with counts for preserved reviewed documents, new documents, removed pending documents and reviewed documents retained despite being absent from the new spreadsheet.
8. Persistence uses the existing optimistic concurrency guard. If another tab/device changes the inspection during the operation, the merge is rebuilt against the latest local snapshot before one retry.

Changing an expected revision can legitimately change the calculated conformity result, but the observed revision, copies, evidence and comments remain untouched. This makes the catalog current without rewriting what was actually observed in the field.
