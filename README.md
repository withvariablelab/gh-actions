# Variable Lab — GitHub Actions

Reusable GitHub Actions used across Variable Lab and Variable Land projects.

## Actions

| Action | Description |
| --- | --- |
| [`preview-release`](./actions/preview-release/README.md) | Publish a per-PR preview release of a standalone library (single package, not a workspace) to npm (OIDC-first, with optional `NPM_TOKEN` fallback). The PR comment comes from the [`vland-bot`](https://bot.variable.land) server (`mode: server`, default) or from a separate job that never runs PR code (`mode: publish` + `mode: comment`, see [`preview-comment`](#reusable-workflows)). |
| [`monorepo-preview-release`](./actions/monorepo-preview-release/README.md) | Publish a per-PR preview release of changed packages in a pnpm monorepo to npm (OIDC-first, with optional `NPM_TOKEN` fallback). The PR comment comes from the [`vland-bot`](https://bot.variable.land) server (`mode: server`, default) or from a separate job that never runs PR code (`mode: publish` + `mode: comment`, see [`preview-comment`](#reusable-workflows)). |
| [`railway-redeploy`](./actions/railway-redeploy/README.md) | Trigger a redeploy of a Railway service via the Railway GraphQL API. Resolves the target service from `project_id` + `environment` + `service_name`, so no service ID lookup is needed. |
| [`setup-pnpm`](./actions/setup-pnpm/README.md) | Install pnpm, upgrade npm, cache the pnpm store, and install dependencies. |
| [`setup-bun`](./actions/setup-bun/README.md) | Install Bun pinned to the version in `.bun-version`. |
| [`setup-pnpm-bun`](./actions/setup-pnpm-bun/README.md) | Combined `setup-pnpm` + `setup-bun` for workflows that need both runtimes. |

## Reusable workflows

| Workflow | Description |
| --- | --- |
| [`preview-comment`](./.github/workflows/preview-comment.yml) | Job 2 of the two-job preview pattern: mints a `vland-bot` token (current repo, `pull-requests: write`) and upserts the preview-release PR comment from the `packages` output of a `mode: publish` job, without checking out or running PR code. Setup and caller example in the [`preview-release`](./actions/preview-release/README.md#two-job-previews) and [`monorepo-preview-release`](./actions/monorepo-preview-release/README.md#two-job-previews) READMEs. |

```yml
preview-comment:
  needs: preview
  permissions: {}
  uses: withvariablelab/gh-actions/.github/workflows/preview-comment.yml@main
  with:
    action: monorepo-preview-release # or preview-release
    packages: ${{ needs.preview.outputs.packages }}
  secrets:
    VLAND_BOT_PRIVATE_KEY: ${{ secrets.VLAND_BOT_PRIVATE_KEY }}
```

## Versioning

Pin actions to a tag or commit SHA when you need stability:

```yml
uses: withvariablelab/gh-actions/actions/<action-name>@<tag-or-sha>
```

`@main` tracks the latest changes on the default branch.

## Node action convention

Every Node-based action in this monorepo follows the same shape:

1. **`action.yml`** declares `runs.using: node24` and `main: dist/index.js`.
2. **Source** lives in `src/`. The bundled output (`dist/index.js`) is committed to the repo and runs directly on the GitHub Actions runner — no Docker build, no install at runtime.
3. **`mise.toml`** declares a `build` task that runs `ncc build src/index.ts -o dist`. Mise's incremental `sources`/`outputs` tracking skips the rebuild when nothing has changed.
4. The **lefthook `pre-push` hook** runs `mise run build` for any push that touches `actions/*/src/**` and blocks the push if `dist/` is out of sync with `src/`.
5. The CI workflow **`Check actions dist sync`** enforces the same invariant on every PR and is required by branch protection. Anyone who bypasses the local hook still gets caught here.
6. **Unit tests** live next to the code as `src/**/*.test.ts` and run with Node's built-in test runner (`node --test`, native type stripping, no extra dependencies): `mise run test` per action or at the root. The pre-push hook and `Check actions dist sync` run them too.
7. `preview-release` and `monorepo-preview-release` carry **byte-identical copies** of the comment-mode code (`src/comment.ts`, `src/types.ts`) and the shared tests (`src/comment.test.ts`, `src/core.test.ts`). Change both copies together; CI diffs them.

To add a new Node action, copy the structure of `monorepo-preview-release` or `railway-redeploy`, adjust inputs and logic, and run `mise run build` (or just `git push` — the hook will do it for you and tell you to commit the dist change).
