# Automation Roadmap

## Phase 1 — deterministic automation foundation

- cancellable CI quality gate;
- E2E path filtering;
- removal of duplicated static checks from E2E;
- weekly grouped Dependabot maintenance;
- PR quality checklist;
- self-hosted Windows E2E workflow prepared;
- automation contracts tested by `npm run check`.

## Phase 2 — local runner activation

- register trusted Windows x64 runner;
- validate `Local Windows E2E Runner` manually;
- measure runtime and reliability;
- migrate expensive browser jobs only after stable smoke results.

## Phase 3 — focused test routing

- map source areas to focused regression suites;
- execute focused tests during implementation;
- preserve full deterministic suite at final stabilization;
- keep browser E2E reserved for browser-impacting paths.

## Phase 4 — local heuristic reviewer

Evaluate an optional open-source local code model only after deterministic automation is mature. It may provide non-authoritative review notes, but it must not replace executable tests, security boundaries or governance.

## Principle

Automate repeatable facts first. Use human/AI judgment only for decisions that cannot be expressed as stable executable contracts.
