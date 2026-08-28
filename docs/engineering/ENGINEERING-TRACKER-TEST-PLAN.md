# Engineering Tracker Verification Gate

## Functional scope

The Engineering tracker is only eligible for promotion after the full stacked head has been exercised, not merely compiled.

Required checks:

- Only active documents with `Amarelo` or `Vermelho` markings appear in the Engineering queue.
- Sending date, return date and note persist in inspection audit history.
- Return without a sending date is rejected and creates no audit event.
- `Sem retorno` and `Maior espera` update immediately after save without reopening the dialog.
- An open per-document audit view refreshes immediately after save.
- Search and Yellow/Red/status filters do not alter persisted state.
- A stale-device merge preserves Engineering audit events and unrelated newer field-copy edits.
- The 320 px mobile layout has no horizontal overflow and the fifth navigation item remains inside the viewport.
- The modal backdrop still spans the full viewport; width/scroll limits apply to the inner dialog only.
- A saved Engineering state can be reopened from local IndexedDB while the PWA is offline.
- Existing document recovery remains reachable only to roles with `MANAGE_DOCUMENTS`.

## Stack regression scope

Before promotion, also exercise the earlier stacked changes together:

- authoritative inspection-list replacement with fewer and more incoming documents;
- preservation of matching field data and archival of removed documents;
- recovery of a removed document from history;
- retirement of new confidential-PDF upload while historical PDF viewing remains intact;
- OCR engineering pipeline, including separator-loss recovery and the no-fuzzy-substitution rule;
- PWA reopen offline after the new modules are cached.

## Evidence rule

A green CI result is necessary but not sufficient. Review the browser job steps and Playwright artifacts. Before describing the feature as concluded, perform a smoke against a published preview or production-like deployment and record any discrepancy before promotion.

No production data mutation or schema migration is required by this tracker feature.
