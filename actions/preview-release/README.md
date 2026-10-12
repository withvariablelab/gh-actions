# Preview release

GitHub Action that publishes a **per-PR preview release** of a standalone library (a single npm package, not part of a workspace) and gets a sticky comment posted on the pull request with the published version.

For each PR:

- The package in `working_directory` (default the repo root) gets its version bumped to `<current>-git-<short-sha>` (prerelease).
- The package is published to npm under the dist-tag `pr-<pr-number>`.
- Private packages (`"private": true`) are skipped.
- A package's **first ever publish** is a special case: npm force-assigns the `latest` dist-tag to it (and won't let that tag be removed), so the preview becomes the default `pnpm add <pkg>` target until a stable release re-points `latest`. The action flags these first-time publishes so the PR comment can warn about it. See [First-time publishes & `latest`](#first-time-publishes--latest).
- The PR comment is posted either by the `vland-bot` server (`mode: server`, the default) or by a second job that never runs PR code (`mode: publish` + `mode: comment`). See [Modes](#modes).

> Working in a pnpm monorepo? Use [`monorepo-preview-release`](../monorepo-preview-release/README.md) instead — it detects changed packages and their workspace dependents.

## Modes

The `mode` input picks what a run does:

| `mode` | Publishes | Comments | Use it for |
| --- | --- | --- | --- |
| `server` (default) | yes | via the `vland-bot` server: the action POSTs the result, authenticated with a GitHub OIDC token (audience `vland-bot`) | variableland repos. This is the behaviour from before modes existed. |
| `publish` | yes | no. Sets the [`packages`, `pr-number` and `head-sha` outputs](#outputs) instead | Job 1 of the [two-job pattern](#two-job-previews) |
| `comment` | no | yes, directly: upserts the comment with `github_token` | Job 2 of the two-job pattern, through the [`preview-comment` reusable workflow](../../.github/workflows/preview-comment.yml) |

## Two-job previews

The `vland-bot` server exists so the bot's private key is never in a job that runs PR code (the preview job installs and builds the PR). The two-job pattern keeps that property without the server:

1. **`preview`** runs the PR code and publishes with npm OIDC (`mode: publish`). It has `id-token: write` and `contents: read`, no app key, and only hands the published package list to the next job as an output.
2. **`preview-comment`** (`needs: preview`) calls the reusable workflow [`preview-comment.yml`](../../.github/workflows/preview-comment.yml). That workflow never checks out or runs PR code: it mints a `vland-bot` installation token (current repo only, `pull-requests: write`) and runs this action with `mode: comment`, which validates the package list and upserts the comment.

The comment has the same layout and the same `<!-- preview-release-bot -->` marker as the one the server posts, and it is posted by the same `vland-bot` app, so job 2 updates comments the server created earlier.

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
  # other jobs like test, lint, build...

  preview:
    runs-on: ubuntu-latest
    needs: test
    if: ${{ startsWith(github.head_ref, 'feat') || startsWith(github.head_ref, 'fix') }}
    permissions:
      contents: read
      id-token: write # npm trusted publishing (OIDC)
    outputs:
      packages: ${{ steps.preview.outputs.packages }}
    steps:
      - name: ⬇️ Checkout repo
        uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
        with:
          persist-credentials: false

      - name: 🟢 Setup Node.js
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0
        with:
          node-version-file: .node-version

      - name: ⌛ Setup pnpm
        uses: withvariablelab/gh-actions/actions/setup-pnpm@main

      - name: 🚀 Preview release
        id: preview
        uses: withvariablelab/gh-actions/actions/preview-release@main
        with:
          mode: publish
          publish_mode: oidc-only

  preview-comment:
    needs: preview
    permissions: {}
    uses: withvariablelab/gh-actions/.github/workflows/preview-comment.yml@main
    with:
      action: preview-release
      packages: ${{ needs.preview.outputs.packages }}
    secrets:
      VLAND_BOT_PRIVATE_KEY: ${{ secrets.VLAND_BOT_PRIVATE_KEY }}
```

What the caller needs:

- The org (or repo) **variable** `VLAND_BOT_CLIENT_ID` and **secret** `VLAND_BOT_PRIVATE_KEY`. The reusable workflow reads `vars.VLAND_BOT_CLIENT_ID` itself: in a called workflow, `vars` resolves against the caller's repository. The secret is passed explicitly (no `secrets: inherit`).
- `vland-bot` installed on the repository.
- `packages` travels **only** through `outputs:` and `with:`. Never interpolate `needs.preview.outputs.packages` (or any other output of the preview job) into a `run:` script: that job ran PR code, so its outputs are untrusted and would be a script injection.

`preview-comment.yml` inputs:

| Input | Required | Description |
| --- | --- | --- |
| `packages` | yes | The `packages` output of the publish job. |
| `action` | yes | `preview-release` or `monorepo-preview-release`: the same action the publish job used. |

If `preview` fails or is skipped, `needs` skips `preview-comment` too.

## Usage

`mode: server` (default), as used by variableland repos:

```yml
- name: 🚀 Preview release
  uses: withvariablelab/gh-actions/actions/preview-release@main
  with:
    npm_token: ${{ secrets.NPM_TOKEN }} # optional, see "Authentication modes" below
```

For `publish` + `comment`, see [Two-job previews](#two-job-previews).

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `mode` | no | `server` | `server`, `publish` or `comment`. See [Modes](#modes). |
| `npm_token` | no | — | `server`/`publish` only. npm classic/automation token. When set, enables the OIDC + token fallback mode (see below). |
| `publish_mode` | no | auto-detected | `server`/`publish` only. Override the [authentication mode](#authentication-modes): `token-only`, `oidc-only` or `oidc-with-token-fallback`. |
| `working_directory` | no | `.` | `server`/`publish` only. Directory containing the `package.json` to publish. Use this when the library lives in a subdirectory. |
| `vland_bot_url` | no | `https://bot.variable.land` | `server` only. Base URL of the `vland-bot` server that receives the post-publish notification. |
| `packages` | in `comment` | — | `comment` only. The `packages` output of a `publish` run (JSON). |
| `github_token` | in `comment` | — | `comment` only. Token that can write PR comments (the `vland-bot` token minted by `preview-comment.yml`). |

## Outputs

Set in `mode: publish` only:

| Output | Description |
| --- | --- |
| `packages` | JSON array with the published package (`[]` when the package is private). Fields below. |
| `pr-number` | Number of the pull request. |
| `head-sha` | Head commit SHA of the pull request. |

Each `packages` entry (the same payload `mode: server` POSTs to `vland-bot` at `POST <vland_bot_url>/v1/github/preview-release`):

| Field | Type | Description |
| --- | --- | --- |
| `packageName` | `string` | The npm package name. |
| `nextVersion` | `string` | The published preview version (`<current>-git-<short-sha>`). |
| `firstTime` | `boolean` | `true` when this run published the package's very first version. npm makes that version `latest` (unavoidably — see below), so the comment warns that `pnpm add <pkg>` currently resolves to a preview build until a stable release re-points `latest`. |

## Required permissions

`server` and `publish` (the job that runs the PR code):

```yml
permissions:
  contents: read
  id-token: write   # npm Trusted Publisher (and, in server mode, the vland-bot OIDC token)
```

`comment`: none from `GITHUB_TOKEN` (`permissions: {}`). It uses the app token passed as `github_token`, which needs `pull-requests: write` on the current repository.

## Authentication modes

`server` and `publish` pick one of three npm publishing modes automatically based on the directory state and the inputs (override with `publish_mode`):

| Detected state | Mode | Behavior |
| --- | --- | --- |
| `.npmrc` already provides auth | `token-only` | Publishes using the existing `.npmrc` credentials. Never adds `--provenance`. |
| `npm_token` input is provided (and no `.npmrc` auth) | `oidc-with-token-fallback` | Publishes with OIDC + provenance via `pnpm publish --provenance`. If the publish fails **and** the package is unpublished on npm, it falls back to `NPM_TOKEN` auth without provenance. |
| Neither of the above | `oidc-only` | Publishes with OIDC + provenance. Any failure is fatal. |

The `oidc-with-token-fallback` mode exists to handle the **first-time publish** of a package that doesn't yet have a Trusted Publisher configured on npm: it lands via the token (no provenance), and every subsequent publish keeps its provenance attestation.

## First-time publishes & `latest`

npm requires every package to always have a `latest` dist-tag, so the **first** version ever published becomes `latest` — even when `pnpm publish --tag pr-<n>` is used. There is no way around this: npm rejects any attempt to delete the `latest` tag (`npm dist-tag rm <pkg> latest` returns `400 Bad Request`), and a package cannot exist without one.

So for a brand-new package, the first PR preview unavoidably becomes the version that `pnpm add <pkg>` (no tag) resolves to, until a stable release re-points `latest`.

The action does not try to fix this at the registry (it can't). Instead it detects the first-time publish and reports `firstTime: true`, and the PR comment marks the package with `†` and a footnote. The published preview stays installable by tag or exact version:

- `pnpm add <pkg>@pr-<n>` — by PR tag.
- `pnpm add <pkg>@<version>` — by exact `<current>-git-<short-sha>` version.

The fix is to cut a real release: the normal release pipeline publishes a stable version and re-points `latest` to it.

## How publishing works

The action shells out to the real `pnpm` CLI for the heavy lifting:

- `pnpm version prerelease --preid git-<sha> --no-git-tag-version` to bump.
- `pnpm publish --tag pr-<n> --no-git-checks [--provenance]` to publish.

`pnpm publish` takes care of `publishConfig` overrides, lifecycle scripts (`prepublishOnly`, `prepack`, `prepare`), and the npm Trusted Publisher OIDC exchange. This action just orchestrates the bump and the auth-mode selection.

The mutating commands (`pnpm version`, `pnpm publish`) stream their combined output to the Actions log inside collapsible groups, so a run's progress is visible. The JSON query command (`pnpm view`) stays silent — its output is parsed, not displayed.

## Requirements on the calling workflow

In `server` and `publish` modes `pnpm publish` is invoked from inside the action, so the caller's job needs:

- **`pnpm` available in `PATH`** — easiest via [`withvariablelab/gh-actions/actions/setup-pnpm`](../setup-pnpm/README.md) or `corepack enable`.
- **A populated `node_modules`** — `pnpm install` must run before the action so lifecycle scripts (`prepack` / `prepare` doing `pnpm build`, `tsdown`, etc.) can find their devDependencies.

`comment` mode needs none of that: it runs in an empty job.

## Security notes

- The action **refuses to run on `pull_request_target`** in every mode. That trigger gives the workflow access to base-branch secrets while letting it check out PR-controlled code, which combined with lifecycle scripts in `prepack`/`prepare` would let any PR exfiltrate the publish credentials. Use `on: pull_request` — GitHub strips secrets for fork PRs there.
- `comment` mode treats `packages` as untrusted (it comes from a job that ran PR code) and refuses to run unless:
  - the event is not `pull_request_target` or `workflow_run`;
  - `GITHUB_WORKSPACE` is empty, i.e. nothing in the job checked out or wrote files (the reusable workflow has no checkout, and callers cannot add steps to it);
  - `packages` is valid JSON of at most 64 KiB and matches a strict schema: an array of at most 100 objects with exactly `packageName` (lowercase npm name, optionally scoped, at most 214 characters), `nextVersion` (semver) and an optional boolean `firstTime`. Anything else is rejected, and the error names only the failing fields, never the input itself.
- The PR number and head SHA come from the event payload, not from the previous job. Package names and versions are rendered inside code spans, so they can't turn into links, mentions or markup.
- When updating, only comments authored by a bot that carry the marker are considered, so a human comment quoting the marker is never edited.
- All runtime tokens (`github_token`, the npm auth token transiently written to `~/.npmrc`, and the `vland-bot` OIDC token) are registered with `core.setSecret` so accidental log echoes are masked by the runner. Tokens are never logged.
