# Development

How to work on gh-actions in a clone. The [contributing guide](contributing.md) covers how a change gets in.

## Layout

- `actions/<name>/`: one action per folder, named as in `uses:`, with its README. A Node action also holds `src/`, the committed `dist/`, and its own `package.json`, `package-lock.json`, `mise.toml`, `tsconfig.json` and `biome.json`. A composite action holds only `action.yml` and its README.
- `.github/workflows/`: the repository's own CI, and [`preview-comment.yml`](../.github/workflows/preview-comment.yml), the reusable workflow that callers run.
- The root: the tooling the actions share (Biome, TypeScript, run-run and lefthook), installed with pnpm, and the mise tasks that run in every action.

## Setup

[mise](https://mise.jdx.dev) pins Node 24 and pnpm 10.30.3 in `mise.toml`, which needs mise 2026.6.6 or later. The repository has no `mise.lock`. `mise.toml` makes the root a mise monorepo with each folder in `actions/` as a config root, so a task run at the root runs in every action that declares it. It also puts `node_modules/.bin` on the `PATH`, so the tools run by name.

```sh
mise run setup         # mise install, pnpm install, then npm install in each Node action
pnpm lefthook install  # the git hooks, once per clone
```

pnpm doesn't run lefthook's install script (`ignoredBuiltDependencies` in `package.json`), so the hooks wait for `lefthook install`.

## Tasks

```sh
mise run check       # Biome, then the type check, in every Node action
mise run tsc         # only the type check
mise run test        # the unit tests, in every action that has them
mise run build       # build dist/ in every Node action, skipped when nothing changed
mise run check-dist  # rebuild every dist/, and fail if it differs from the commit
```

In an action's folder, `mise run <task>` runs that action's task only.

## CI

- **On each pull request:** Check actions dist sync diffs the comment code that `preview-release` and `monorepo-preview-release` share, then runs `mise run test` and `mise run check-dist`. Workflow audit runs zizmor on the workflows, and runs again on each push to `main` (see [Security linting](#security-linting)). Both are required checks.
- **Git hooks** ([lefthook](https://lefthook.dev)): on commit, `mise run check` when a TypeScript file or a `tsconfig.json` under `actions/` is staged. On push, `mise run test` when an action's `src/` or `package.json` changed, and `mise run check-dist` when its `src/`, `dist/`, `package.json`, `package-lock.json` or `tsconfig.json` changed.
- **Every Monday:** Dependency audit runs `pnpm audit` on the root lockfile and `npm audit` in each Node action, and keeps an issue labeled `dependency-audit` open while it finds known vulnerabilities.

## Node action convention

Every Node action in this repository has the same shape:

1. **`action.yml`** declares `runs.using: node24` and `main: dist/index.js`.
2. **The source** is in `src/`. The bundle, `dist/index.js`, is committed to the repository and runs as is on the GitHub Actions runner: no Docker build, and no install at run time.
3. **`mise.toml`** declares a `build` task that bundles `src/index.ts` into `dist/` with ncc, minified and with the dependency licenses in `dist/licenses.txt`. mise tracks its `sources` and `outputs` and skips the build when nothing changed, so `mise run build` does **not** catch a hand-edited `dist/`. The root **`check-dist`** task does: it rebuilds every `dist/` with `--force`, and fails if anything under `dist/` differs from the commit, new files included.
4. The **lefthook `pre-push` hook** runs `mise run check-dist` for any push that touches an action's `src/`, `dist/`, `package.json`, `package-lock.json` or `tsconfig.json`, and blocks the push when `dist/` is out of sync with `src/`.
5. CI (Check actions dist sync) runs `check-dist` on every pull request. It is a required check, so a push that skips the local hook is still caught.
6. **Unit tests** sit next to the code as `src/**/*.test.ts`, and run with Node's built-in test runner (`node --test`, with native type stripping and no extra dependencies): `mise run test` in an action or at the root. The pre-push hook and Check actions dist sync run them too.
7. `preview-release` and `monorepo-preview-release` hold **byte-identical copies** of the comment-mode code (`src/comment.ts`, `src/types.ts`) and of the shared tests (`src/comment.test.ts`, `src/core.test.ts`). Change both copies together: CI diffs them.

To add a Node action, copy the structure of `monorepo-preview-release` or `railway-redeploy`, change the inputs and the logic, and run `mise run build`. `mise run check-dist` works too: the pre-push hook runs it, and it tells you to commit the change to `dist/`.

## Dependency cooldown

A new dependency version has to be at least 24 hours old before it gets in. Most malicious releases are pulled within the first hour.

- **Root tooling** (pnpm): [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) sets `minimumReleaseAge: 1440`, except for `@variablelab/*` and `@rrlab/*`. pnpm 10.16 or later, pinned in `package.json` and `mise.toml`, refuses a version that is too new with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`.
- **Action dependencies** (npm, one `package-lock.json` per action): npm 11.10 and later have a lasting cooldown, `min-release-age`, but the actions don't set it. When you add or update a dependency of an action, pass `--before` with a time 24 hours in the past, so npm resolves only versions published before it:

  ```sh
  cd actions/<action>
  npm install <pkg>@<range> --before="$(node -p 'new Date(Date.now() - 864e5).toISOString()')"
  ```

  The same flag works with `npm update`. Then run `mise run check-dist`, and commit the rebuilt `dist/` with the lockfile.
- **The global npm CLI** in `setup-pnpm` and `setup-pnpm-bun`: an exact version, bumped by hand to a release at least 24 hours old (see the comment on the "Update npm" step). Both actions are deprecated in favor of mise, which uses the npm bundled with the locked Node.
- **Security updates:** Dependabot security updates are on in the repository settings, and [`dependabot.yml`](../.github/dependabot.yml) groups them, so Dependabot opens grouped pull requests for the security alerts at the root and in each action, not one pull request per alert. Version updates stay manual. [Dependency audit](../.github/workflows/dependency-audit.yml) audits every lockfile each Monday, and keeps an issue open while advisories remain. Dependabot doesn't rebuild `dist/`: on its pull requests for an action, Check actions dist sync fails until someone runs `mise run check-dist` on the branch and pushes the rebuilt `dist/`. Its pull requests also skip the 24-hour cooldown, because GitHub ignores `cooldown` for security updates and Dependabot runs pnpm with `minimumReleaseAge=0`. Check the fixed version's publish date before you merge one.

## Security linting

Workflow audit ([`workflow-audit.yml`](../.github/workflows/workflow-audit.yml)) runs [zizmor](https://docs.zizmor.sh) on every pull request and every push to `main`, with the config in [`.github/zizmor.yml`](../.github/zizmor.yml). Third-party actions are pinned by SHA, and `withvariablelab/*` is allowed at `@main`. To run it locally: `pipx run --spec zizmor==1.30.1 zizmor .`.
