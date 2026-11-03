# Development

How to work on gh-actions in a clone. The [contributing guide](contributing.md) covers how a change gets in.

## Layout

- `actions/<name>/`: one action per folder, named as in `uses:`, with its README. A Node action also holds `src/`, the committed `dist/`, and its own `package.json`, `package-lock.json`, `mise.toml`, `tsconfig.json` and `biome.json`. A composite action holds only `action.yml` and its README.
- `lefthook/`: the git hook jobs that take the place of `@rrlab/cli`'s shared `jsc` and `tsc`, to run them in every action (see [CI](#ci)).
- `.github/workflows/`: the repository's own CI, and [`preview-comment.yml`](../.github/workflows/preview-comment.yml), the reusable workflow that callers run.
- The root: the tooling the actions share (Biome, TypeScript, run-run and lefthook), installed with pnpm, and the mise tasks that run in every action.

## Setup

[mise](https://mise.jdx.dev) 2026.10.19 or later pins Node 24, pnpm 12 and [gitleaks](https://github.com/gitleaks/gitleaks) in `mise.toml`, locked in `mise.lock`. `mise.toml` makes the root a mise monorepo with each folder in `actions/` as a config root, so a task run at the root runs in every action that declares it. It also puts `node_modules/.bin` on the `PATH`, so the tools run by name.

```sh
mise run setup  # mise install, pnpm install, then npm install in each Node action
```

`pnpm install` also installs the git hooks: lefthook's postinstall writes them. With `CI` set, that postinstall skips them, so after a `CI=1 pnpm install` run `pnpm lefthook install` to add them.

## Tasks

```sh
mise run check       # Biome, then the type check, in every Node action
mise run jsc         # only Biome
mise run tsc         # only the type check
mise run test        # the unit tests, in every action that has them
mise run build       # build dist/ in every Node action, skipped when nothing changed
mise run check-dist  # rebuild every dist/, and fail if it differs from the commit
```

In an action's folder, `mise run <task>` runs that action's task only.

## CI

- **On each pull request to `main`, and each push to `main`:** CI first scans the new commits for secrets with gitleaks. Then its `Test` job, which fails when the scan did, sets up mise 2026.10.19 and the locked tools with [mise-action](https://github.com/jdx/mise-action), installs the root's tooling with `pnpm install --frozen-lockfile` and each Node action's dependencies with `npm ci`, diffs the comment code that `preview-release` and `monorepo-preview-release` share, then runs `mise run check`, `mise run test` and `mise run check-dist`. Workflow audit runs zizmor on the workflows (see [Security linting](#security-linting)).
- **On each pull request:** Check actions dist sync runs the same diff, `mise run test` and `mise run check-dist`. It and Workflow audit are the required checks.
- **Git hooks** ([lefthook](https://lefthook.dev)): `lefthook.yml` extends `base.yml`, the hooks that `@rrlab/cli` ships, then [`lefthook/actions.yml`](../lefthook/actions.yml), and its own `shared-hooks` job fails a commit, saying to run `pnpm install`, when `base.yml` is missing from `node_modules`. On commit, in parallel: gitleaks scans the staged changes for secrets, `mise run jsc` runs when a TypeScript, JSON, Markdown or YAML file under `actions/` is staged, and `mise run tsc` when a TypeScript file or a `tsconfig.json` is. Those two run `rr` in every action, in place of the shared jobs' `rr jsc` and `rr tsc` at the root, which has no `biome.json` or `tsconfig.json`. On push, `mise run test` when an action's `src/` or `package.json` changed, and `mise run check-dist` when its `src/`, `dist/`, `package.json`, `package-lock.json` or `tsconfig.json` changed.
- **Every Monday:** Dependency audit runs `pnpm audit` on the root lockfile and `npm audit` in each Node action, and keeps an issue labeled `dependency-audit` open while it finds known vulnerabilities.

## Node action convention

Every Node action in this repository has the same shape:

1. **`action.yml`** declares `runs.using: node24` and `main: dist/index.js`.
2. **The source** is in `src/`. The bundle, `dist/index.js`, is committed to the repository and runs as is on the GitHub Actions runner: no Docker build, and no install at run time.
3. **`mise.toml`** declares a `build` task that bundles `src/index.ts` into `dist/` with ncc, minified and with the dependency licenses in `dist/licenses.txt`. mise tracks its `sources` and `outputs` and skips the build when nothing changed, so `mise run build` does **not** catch a hand-edited `dist/`. The root **`check-dist`** task does: it rebuilds every `dist/` with `--force`, and fails if anything under `dist/` differs from the commit, new files included.
4. The **lefthook `pre-push` hook** runs `mise run check-dist` for any push that touches an action's `src/`, `dist/`, `package.json`, `package-lock.json` or `tsconfig.json`, and blocks the push when `dist/` is out of sync with `src/`.
5. CI and Check actions dist sync run `check-dist` on every pull request. Check actions dist sync is a required check, so a push that skips the local hook is still caught.
6. **Unit tests** sit next to the code as `src/**/*.test.ts`, and run with Node's built-in test runner (`node --test`, with native type stripping and no extra dependencies): `mise run test` in an action or at the root. The pre-push hook, CI and Check actions dist sync run them too.
7. `preview-release` and `monorepo-preview-release` hold **byte-identical copies** of the comment-mode code (`src/comment.ts`, `src/types.ts`) and of the shared tests (`src/comment.test.ts`, `src/core.test.ts`). Change both copies together: CI diffs them.

To add a Node action, copy the structure of `monorepo-preview-release` or `railway-redeploy`, change the inputs and the logic, and run `mise run build`. `mise run check-dist` works too: the pre-push hook runs it, and it tells you to commit the change to `dist/`.

## Dependency cooldown

A new dependency version has to be at least 24 hours old before it gets in. Most malicious releases are pulled within the first hour.

- **Root tooling** (pnpm): [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) sets `minimumReleaseAge: 1440`, except for `@variablelab/*`, `@rrlab/*` and `@variableland/*`. pnpm, pinned in `mise.toml` and required by `devEngines` in `package.json`, refuses a version that is too new with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`.
- **Action dependencies** (npm, one `package-lock.json` per action): npm 11.10 and later have a lasting cooldown, `min-release-age`, but the actions don't set it. When you add or update a dependency of an action, pass `--before` with a time 24 hours in the past, so npm resolves only versions published before it:

  ```sh
  cd actions/<action>
  npm install <pkg>@<range> --before="$(node -p 'new Date(Date.now() - 864e5).toISOString()')"
  ```

  The same flag works with `npm update`. Then run `mise run check-dist`, and commit the rebuilt `dist/` with the lockfile.
- **The global npm CLI** in `setup-pnpm` and `setup-pnpm-bun`: an exact version, bumped by hand to a release at least 24 hours old (see the comment on the "Update npm" step). Both actions are deprecated in favor of mise, which uses the npm bundled with the locked Node.
- **Security updates:** Dependabot security updates are on in the repository settings, and [`dependabot.yml`](../.github/dependabot.yml) groups them, so Dependabot opens grouped pull requests for the security alerts at the root and in each action, not one pull request per alert. Version updates stay manual. [Dependency audit](../.github/workflows/dependency-audit.yml) audits every lockfile each Monday, and keeps an issue open while advisories remain. Dependabot doesn't rebuild `dist/`: on its pull requests for an action, CI and Check actions dist sync fail until someone runs `mise run check-dist` on the branch and pushes the rebuilt `dist/`. Its pull requests also skip the 24-hour cooldown, because GitHub ignores `cooldown` for security updates and Dependabot runs pnpm with `minimumReleaseAge=0`. Check the fixed version's publish date before you merge one.

## Security linting

Workflow audit ([`workflow-audit.yml`](../.github/workflows/workflow-audit.yml)) runs [zizmor](https://docs.zizmor.sh) on every pull request and every push to `main`, with the config in [`.github/zizmor.yml`](../.github/zizmor.yml). Third-party actions are pinned by SHA, and `withvariablelab/*` is allowed at `@main`. To run it locally: `pipx run --spec zizmor==1.30.1 zizmor .`.
