# DocInspector Automation Pipeline

## Goal

Reduce feedback time and paid-review dependency without weakening engineering gates.

## Pipeline layers

### 1. Deterministic Quality Gate

Runs on every pull request to `develop` or `main` and on pushes to those branches.

Command:

```bash
npm run check
```

It covers JavaScript syntax, SQL validation, secret scanning and regression tests.

The workflow uses concurrency cancellation so superseded commits stop consuming runner time.

### 2. Browser E2E Gate

Runs only when a pull request changes application/runtime/test files that can affect browser behaviour.

Documentation-only and unrelated repository changes do not install Playwright browsers.

The E2E workflow no longer repeats `npm run check`; that contract belongs to the deterministic CI workflow. This removes duplicated work while preserving both gates before merge.

### 3. Dependency maintenance

Dependabot checks npm and GitHub Actions weekly. Minor and patch updates are grouped to reduce PR noise and repeated CI executions.

Major updates remain isolated because they require deliberate compatibility review.

### 4. Self-hosted Windows runner

`.github/workflows/local-runner-e2e.yml` is prepared but intentionally manual until a trusted Windows machine is registered with these labels:

- `self-hosted`
- `Windows`
- `X64`
- `docinspector-e2e`

After the runner is registered and its smoke workflow is green, the normal browser gate can be migrated from `ubuntu-latest` to the local runner to reduce hosted-runner usage.

Do not switch the required E2E workflow to `self-hosted` before the runner is reliably online, otherwise pull requests can remain queued indefinitely.

## Review policy

Deterministic automation replaces repetitive mechanical review, not architectural judgment.

Expected sequence:

1. implement a small change;
2. run focused local tests where practical;
3. push once the block is coherent;
4. deterministic CI evaluates repository contracts;
5. browser E2E runs only when relevant paths changed;
6. fix relevant failures;
7. perform final technical review on a stable diff;
8. merge only with required governance gates satisfied.

Paid AI review is not part of the default pipeline.

## Cost controls

- cancel superseded workflow runs;
- avoid duplicate static/regression execution inside E2E;
- skip browser installation for unrelated changes;
- group safe dependency updates;
- prefer the self-hosted runner for expensive browser work after it is validated;
- keep paid AI review opt-in only.
