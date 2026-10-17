# Setup pnpm + Bun

> [!WARNING]
> **Deprecated.** Install node, pnpm and bun with [mise](https://mise.jdx.dev) through [`jdx/mise-action`](https://github.com/jdx/mise-action) instead. It stays in place for the workflows that still use it. Follow [Migrating to mise](../setup-pnpm/README.md#migrating-to-mise) in `setup-pnpm`, with `bun` added to `[tools]` in `mise.toml` (the version from `.bun-version`).

## Deprecated behavior

The action combines [`setup-pnpm`](../setup-pnpm/README.md) and [`setup-bun`](../setup-bun/README.md) in a single step, for workflows that need both runtimes (e.g. pnpm for the workspace, Bun for scripts or tests).

It runs the full pnpm flow (install pnpm, upgrade npm, cache the store, `pnpm install --frozen-lockfile --prefer-offline`) and then installs Bun from `.bun-version`. Versions of `pnpm`, `npm`, and `bun` are logged at the end.

### Requirements

- `pnpm-lock.yaml` at the repository root and a `packageManager` field in `package.json`.
- `.bun-version` at the repository root containing the Bun version to install. The action fails fast if it's missing.

### Usage

```yml
- name: ⌛ Setup pnpm + Bun
  uses: withvariablelab/gh-actions/actions/setup-pnpm-bun@main
```
