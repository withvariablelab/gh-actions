# Monorepo preview release

GitHub Action that publishes a **per-PR preview release** of every changed package in a pnpm workspace and notifies [`vland-bot`](https://bot.variable.land) so it can post a sticky comment on the pull request with the published versions.

For each PR:

- The packages changed by the PR (and their workspace dependents) are detected via the GitHub PR files API.
- Each package gets its version bumped to `<current>-git-<short-sha>` (prerelease).
- Each package is published to npm under the dist-tag `pr-<pr-number>`.
- Private packages (`"private": true`) are excluded.
- A package's **first ever publish** is a special case: npm force-assigns the `latest` dist-tag to it (and won't let that tag be removed), so the preview becomes the default `pnpm add <pkg>` target until a stable release re-points `latest`. The action flags these first-time publishes to `vland-bot` so the PR comment can warn about it. See [First-time publishes & `latest`](#first-time-publishes--latest).
- Once publishing finishes, the action calls the `vland-bot` server (authenticated with a GitHub OIDC token scoped to the `vland-bot` audience) so it can comment on the PR.

## Usage

```yml
- name: 🚀 Preview release
  uses: withvariablelab/gh-actions/actions/monorepo-preview-release@main
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    npm_token: ${{ secrets.NPM_TOKEN }} # optional, see "Authentication" below
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github_token` | yes | — | Token used for the GitHub API (typically `${{ secrets.GITHUB_TOKEN }}`). |
| `npm_token` | no | — | npm classic/automation token. When set, enables the OIDC + token fallback mode (see below). |
| `vland_bot_url` | no | `https://bot.variable.land` | Base URL of the `vland-bot` server that receives the post-publish notification. |

## Required permissions

The calling job needs:

```yml
permissions:
  contents: read
  id-token: write   # required to mint the GitHub OIDC token (npm Trusted Publisher + vland-bot auth)
```

## Authentication modes

The action picks one of three publishing modes automatically based on the workspace state and the inputs:

| Detected state | Mode | Behavior |
| --- | --- | --- |
| `.npmrc` already provides auth | `token-only` | Publishes using the existing `.npmrc` credentials. Never adds `--provenance`. |
| `npm_token` input is provided (and no `.npmrc` auth) | `oidc-with-token-fallback` | Publishes each package with OIDC + provenance via `pnpm publish --provenance`. If a given package's publish fails **and** the package is unpublished on npm, it falls back to `NPM_TOKEN` auth without provenance. |
| Neither of the above | `oidc-only` | Publishes with OIDC + provenance. Any failure is fatal. |

The `oidc-with-token-fallback` mode exists to handle **first-time publishes** of packages that don't yet have a Trusted Publisher configured on npm: those land via the token (no provenance), while every other package keeps its provenance attestation.

## Outputs

This action has no GitHub Action outputs. The PR comment is produced by `vland-bot`, not by the action itself.

The action POSTs the published packages to `vland-bot` (`POST <vland_bot_url>/v1/github/preview-release`). Each entry is:

| Field | Type | Description |
| --- | --- | --- |
| `packageName` | `string` | The npm package name. |
| `nextVersion` | `string` | The published preview version (`<current>-git-<short-sha>`). |
| `firstTime` | `boolean` | `true` when this run published the package's very first version. npm makes that version `latest` (unavoidably — see below), so `vland-bot` can use this flag to warn in the comment that `pnpm add <pkg>` currently resolves to a preview build until a stable release re-points `latest`. |

## First-time publishes & `latest`

npm requires every package to always have a `latest` dist-tag, so the **first** version ever published becomes `latest` — even when `pnpm publish --tag pr-<n>` is used. There is no way around this: npm rejects any attempt to delete the `latest` tag (`npm dist-tag rm <pkg> latest` returns `400 Bad Request`), and a package cannot exist without one.

So for a brand-new package, the first PR preview unavoidably becomes the version that `pnpm add <pkg>` (no tag) resolves to, until a stable release re-points `latest`.

The action does not try to fix this at the registry (it can't). Instead it detects first-time publishes and reports `firstTime: true` to `vland-bot`, which can warn in the PR comment. Each published preview stays installable by tag or exact version:

- `pnpm add <pkg>@pr-<n>` — by PR tag.
- `pnpm add <pkg>@<version>` — by exact `<current>-git-<short-sha>` version.

The fix is to cut a real release: the normal release pipeline publishes a stable version and re-points `latest` to it.

## How publishing works

The action shells out to the real `pnpm` CLI for the heavy lifting:

- `pnpm list -r --json --depth 0` to enumerate the workspace.
- `pnpm version prerelease --preid git-<sha> --no-git-tag-version` to bump.
- `pnpm publish --tag pr-<n> --no-git-checks [--provenance]` to publish.

`pnpm publish` takes care of `workspace:*` and `catalog:` resolution, `publishConfig` overrides, lifecycle scripts (`prepublishOnly`, `prepack`, `prepare`), and the npm Trusted Publisher OIDC exchange. This action just orchestrates which packages get bumped and the auth-mode selection.

The mutating commands (`pnpm version`, `pnpm publish`) stream their combined output to the Actions log inside collapsible groups, so a run's progress is visible. The JSON query commands (`pnpm list`, `pnpm view`) stay silent — their output is parsed, not displayed.

## Requirements on the calling workflow

Because `pnpm publish` is invoked from inside the action, the caller's job needs:

- **`pnpm` available in `PATH`** — easiest via [`withvariablelab/gh-actions/actions/setup-pnpm`](../setup-pnpm/README.md) or `corepack enable`.
- **A populated `node_modules`** — `pnpm install` must run before the action so lifecycle scripts (`prepack` / `prepare` doing `pnpm build`, `tsdown`, etc.) can find their devDependencies.

## Security notes

- The action **refuses to run on `pull_request_target`**. That trigger gives the workflow access to base-branch secrets while letting it check out PR-controlled code, which combined with lifecycle scripts in `prepack`/`prepare` would let any PR exfiltrate the publish credentials. Use `on: pull_request` — GitHub strips secrets for fork PRs there.
- All runtime tokens (the GitHub OIDC token, the npm auth token transiently written to `~/.npmrc`, and the `vland-bot` OIDC token) are registered with `core.setSecret` so accidental log echoes are masked by the runner.

## Example

```yml
name: CI

on:
  pull_request:
    branches:
      - main

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # other steps like test, lint, build...

  preview:
    runs-on: ubuntu-latest
    needs: test
    if: ${{ startsWith(github.head_ref, 'feat') || startsWith(github.head_ref, 'fix') }}
    permissions:
      contents: read
      id-token: write
    steps:
      - name: ⬇️ Checkout repo
        uses: actions/checkout@v4

      - name: 🟢 Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version-file: .node-version

      - name: ⌛ Setup pnpm
        uses: withvariablelab/gh-actions/actions/setup-pnpm@main

      - name: 🚀 Preview release
        uses: withvariablelab/gh-actions/actions/monorepo-preview-release@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          npm_token: ${{ secrets.NPM_TOKEN }} # optional
```
