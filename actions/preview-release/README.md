# preview-release

This action publishes a **per-PR preview release** of a standalone library, a single npm package outside a workspace, and gets a sticky comment with the published version posted on the pull request.

> For a pnpm monorepo, use [`monorepo-preview-release`](../monorepo-preview-release/README.md) instead: it detects the changed packages, and publishes with them any workspace dependency that has never been published to npm.

## Modes

The PR comment is posted either by the `vland-bot` server (`mode: server`, the default) or by a second job that never runs PR code (`mode: publish` and `mode: comment`). The `mode` input picks what a run does:

| `mode` | Publishes | Comments | Use it for |
| --- | --- | --- | --- |
| `server` (default) | yes | Through the `vland-bot` server: the action POSTs the result, authenticated with a GitHub OIDC token (audience `vland-bot`). | Repos that let the `vland-bot` server post the comment. It is the behavior from before modes existed. |
| `publish` | yes | No. It sets the [`packages`, `pr-number` and `head-sha` outputs](#outputs) instead. | Job 1 of the [two-job pattern](#two-job-previews). |
| `comment` | no | Yes, directly: it upserts the comment with `github_token`. | Job 2 of the two-job pattern, through the [`preview-comment` reusable workflow](../../.github/workflows/preview-comment.yml). |

## Usage

`mode: server`, the default, needs only the step:

```yml
- name: 🚀 Preview release
  uses: withvariablelab/gh-actions/actions/preview-release@main
```

For `publish` and `comment`, see [Two-job previews](#two-job-previews).

### Two-job previews

The `vland-bot` server exists so the bot's private key is never in a job that runs PR code: the preview job installs and builds the PR. The two-job pattern keeps that property without the server:

1. **`preview`** runs the PR code and publishes with npm OIDC (`mode: publish`). It has `id-token: write` and `contents: read`, no app key, and only hands the published package list to the next job, as an output.
2. **`preview-comment`** (`needs: preview`) calls the reusable workflow [`preview-comment.yml`](../../.github/workflows/preview-comment.yml). That workflow never checks out or runs PR code: it mints a `vland-bot` installation token, for the current repo only and with `pull-requests: write`, and runs this action with `mode: comment`, which validates the package list and upserts the comment.

The comment has the same layout and the same `<!-- preview-release-bot -->` marker as the one the server posts, and the same `vland-bot` app posts it, so job 2 updates comments the server created earlier.

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
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: 🛠️ Setup mise
        uses: jdx/mise-action@c2a87611a18de5b3828c5652fe268e992400cb5c # v4.3.0
        with:
          install: true
          cache: true

      - name: 📦 Install dependencies
        run: pnpm install --frozen-lockfile

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

- The org or repo **variable** `VLAND_BOT_CLIENT_ID` and **secret** `VLAND_BOT_PRIVATE_KEY`. The reusable workflow reads `vars.VLAND_BOT_CLIENT_ID` itself: in a called workflow, `vars` resolves against the caller's repository. The secret is passed explicitly, with no `secrets: inherit`.
- `vland-bot` installed on the repository.
- `packages` travels **only** through `outputs:` and `with:`. Never interpolate `needs.preview.outputs.packages`, or any other output of the preview job, into a `run:` script: that job ran PR code, so its outputs are untrusted and would be a script injection.

`preview-comment.yml` inputs:

| Input | Required | Description |
| --- | --- | --- |
| `packages` | yes | The `packages` output of the publish job. |
| `action` | yes | `preview-release` or `monorepo-preview-release`: the same action the publish job used. |

If `preview` fails or is skipped, `needs` skips `preview-comment` too.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `mode` | no | `server` | `server`, `publish` or `comment`. See [Modes](#modes). |
| `npm_token` | no | — | `server` and `publish` only. An npm classic or automation token. When set, and `working_directory` has no `.npmrc`, it turns on the OIDC and token fallback mode (see [Authentication modes](#authentication-modes)). |
| `publish_mode` | no | detected | `server` and `publish` only. Overrides the [authentication mode](#authentication-modes): `token-only`, `oidc-only` or `oidc-with-token-fallback`. |
| `working_directory` | no | `.` | `server` and `publish` only. The directory with the `package.json` to publish, for a library that lives in a subdirectory. |
| `vland_bot_url` | no | `https://bot.variable.land` | `server` only. The base URL of the `vland-bot` server that gets the notification after the publish. |
| `packages` | in `comment` | — | `comment` only. The `packages` output of a `publish` run, as JSON. |
| `app_slug` | in `comment` | — | `comment` only. The slug of the GitHub App behind `github_token` (`preview-comment.yml` passes the `app-slug` output of `actions/create-github-app-token`). Only a marker comment written by `<app_slug>[bot]` is updated. |
| `github_token` | in `comment` | — | `comment` only. A token that can write PR comments: the `vland-bot` token that `preview-comment.yml` mints. |

## Outputs

Set in `mode: publish` only:

- `packages`: a JSON array with the published package, or `[]` when the package is private. Its fields are below.
- `pr-number`: the number of the pull request.
- `head-sha`: the head commit SHA of the pull request.

Each `packages` entry is one item of the `packages` array that `mode: server` POSTs to `vland-bot` at `POST <vland_bot_url>/v1/github/preview-release`, beside `owner`, `repo`, `prNumber` and `latestCommitSha`:

| Field | Type | Description |
| --- | --- | --- |
| `packageName` | `string` | The npm package name. |
| `nextVersion` | `string` | The published preview version: the prerelease of the current version with the preid `git-<short-sha>`, so `1.2.3` becomes `1.2.4-git-abc1234.0`. |
| `firstTime` | `boolean` | `true` when this run published the package's first version ever. npm makes that version `latest`, and nothing can prevent it (see [First-time publishes & `latest`](#first-time-publishes--latest)), so the comment warns that `pnpm add <pkg>` resolves to a preview build until a stable release moves `latest`. |

## Requirements

In `server` and `publish` modes, the action runs `pnpm publish` itself, so the caller's job needs:

- **`pnpm` on the `PATH`.** Install node and pnpm with mise through [`jdx/mise-action`](https://github.com/jdx/mise-action), as in the [two-job example](#two-job-previews). See [Migrating to mise](../setup-pnpm/README.md#migrating-to-mise).
- **A populated `node_modules`.** `pnpm install` has to run before the action, so lifecycle scripts (`prepack` or `prepare` running `pnpm build`, `tsdown` and the like) find their devDependencies.

`comment` mode needs none of that: it runs in an empty job.

## Required permissions

`server` and `publish`, in the job that runs the PR code:

```yml
permissions:
  contents: read
  id-token: write   # npm Trusted Publisher (and, in server mode, the vland-bot OIDC token)
```

`comment`: none from `GITHUB_TOKEN` (`permissions: {}`). It uses the app token passed as `github_token`, which needs `pull-requests: write` on the current repository.

## What a run publishes

- The package in `working_directory`, the repository root by default, gets its version bumped to its prerelease with the preid `git-<short-sha>`: `1.2.3` becomes `1.2.4-git-abc1234.0`.
- The package is published to npm under the dist-tag `pr-<pr-number>`.
- A private package (`"private": true`) is skipped.
- A package's **first publish ever** is a special case. npm gives it the `latest` dist-tag and won't let that tag be removed, so the preview becomes the default `pnpm add <pkg>` target until a stable release moves `latest`. The action flags these first publishes, so the PR comment can warn about it. See [First-time publishes & `latest`](#first-time-publishes--latest).

## Authentication modes

`server` and `publish` pick one of three npm publishing modes from the directory's state and the inputs. `publish_mode` overrides the choice.

- **`token-only`**, when `working_directory` has a `.npmrc`, whatever it holds: publishes with the credentials npm finds, and never adds `--provenance`.
- **`oidc-with-token-fallback`**, when the `npm_token` input is set and `working_directory` has no `.npmrc`: publishes with OIDC and provenance through `pnpm publish --provenance`. If the publish fails **and** the package has never been published to npm, it falls back to `NPM_TOKEN` auth without provenance.
- **`oidc-only`**, in every other case: publishes with OIDC and provenance. Any failure is fatal.

The `oidc-with-token-fallback` mode exists for the **first publish** of a package that has no Trusted Publisher on npm yet: it lands through the token, without provenance, and every later publish keeps its provenance attestation.

## First-time publishes & `latest`

npm requires every package to have a `latest` dist-tag at all times, so the **first** version ever published becomes `latest`, even with `pnpm publish --tag pr-<n>`. There is no way around it: npm rejects any attempt to delete the `latest` tag (`npm dist-tag rm <pkg> latest` returns `400 Bad Request`), and a package can't exist without one.

So for a new package, the first PR preview becomes the version that `pnpm add <pkg>`, with no tag, resolves to, until a stable release moves `latest`.

The action doesn't try to fix this at the registry, because it can't. It detects the first publish and reports `firstTime: true`, and the PR comment marks the package with `†` and a footnote. The published preview stays installable by tag or by exact version:

- `pnpm add <pkg>@pr-<n>`, by the PR's tag.
- `pnpm add <pkg>@<version>`, by the exact version that the PR comment shows.

The fix is a real release: the normal release pipeline publishes a stable version and moves `latest` to it.

## How publishing works

The action runs the real `pnpm` CLI for the work:

- `pnpm version prerelease --preid git-<short-sha> --no-git-tag-version --no-git-checks` to bump.
- `pnpm publish --tag pr-<n> --access public --no-git-checks [--provenance]` to publish.

`pnpm publish` handles `publishConfig` overrides, lifecycle scripts (`prepublishOnly`, `prepack`, `prepare`) and the npm Trusted Publisher OIDC exchange. The action only handles the bump and picks the auth mode.

The commands that change things (`pnpm version`, `pnpm publish`) stream their combined output to the Actions log inside collapsible groups, so a run's progress shows. The JSON query command (`pnpm view`) stays silent: its output is parsed, not shown.

## Security notes

- The action **refuses to run on `pull_request_target`**, in every mode. That trigger gives the workflow the base branch's secrets while it checks out PR code, and with lifecycle scripts in `prepack` or `prepare`, any PR could take the publish credentials. Use `on: pull_request`, where GitHub strips secrets for PRs from forks.
- `comment` mode treats `packages` as untrusted, because it comes from a job that ran PR code, and refuses to run unless:
  - the event is not `pull_request_target` or `workflow_run`;
  - `GITHUB_WORKSPACE` is empty, so nothing in the job checked out or wrote files (the reusable workflow has no checkout, and callers can't add steps to it);
  - `packages` is valid JSON of at most 64 KiB and matches a strict schema: an array of at most 100 objects with exactly `packageName` (a lowercase npm name, scoped or not, of at most 214 characters), `nextVersion` (semver) and an optional boolean `firstTime`. Anything else is rejected, and the error names only the fields that failed, never the input itself.
- The PR number and the head SHA come from the event payload, not from the previous job. Package names and versions are rendered inside code spans, so they can't turn into links, mentions or markup.
- When updating, only marker comments written by the app's own bot account (`<app_slug>[bot]`, a `Bot` user) count. A person or another bot (changeset-bot, github-actions and others) that quotes the marker is never picked: the app token couldn't edit that comment, and the job would fail with a 403 on every run.
- Every runtime token (`github_token`, the npm auth token written to `~/.npmrc` for the publish, and the `vland-bot` OIDC token) is registered with `core.setSecret`, so the runner masks it if a log echoes it by accident. Tokens are never logged.
