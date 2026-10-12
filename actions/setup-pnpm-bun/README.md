# Setup pnpm + Bun

GitHub Action that combines [`setup-pnpm`](../setup-pnpm/README.md) and [`setup-bun`](../setup-bun/README.md) in a single step, for workflows that need both runtimes (e.g. pnpm for the workspace, Bun for scripts or tests).

It runs the full pnpm flow (install pnpm, upgrade npm, cache the store, `pnpm install --frozen-lockfile --prefer-offline`) and then installs Bun from `.bun-version`. Versions of `pnpm`, `npm`, and `bun` are logged at the end.

## Requirements

- `pnpm-lock.yaml` at the repository root and a `packageManager` field in `package.json`.
- `.bun-version` at the repository root containing the Bun version to install. The action fails fast if it's missing.

## Usage

```yml
- name: ⌛ Setup pnpm + Bun
  uses: withvariablelab/gh-actions/actions/setup-pnpm-bun@main
```
