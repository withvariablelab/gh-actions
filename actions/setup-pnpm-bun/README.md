# setup-pnpm-bun

This action does what [`setup-pnpm`](../setup-pnpm/README.md) and [`setup-bun`](../setup-bun/README.md) do in one step, for workflows that need both runtimes, such as pnpm for the workspace and Bun for scripts or tests.

> [!WARNING]
> **Deprecated.** Install node, pnpm and bun with [mise](https://mise.jdx.dev) through [`jdx/mise-action`](https://github.com/jdx/mise-action) instead. The action stays in place for the workflows that still use it. Follow [Migrating to mise](../setup-pnpm/README.md#migrating-to-mise) in `setup-pnpm`, with `bun` added to `[tools]` in `mise.toml` at the version in `.bun-version`.

## Usage

```yml
- name: ⌛ Setup pnpm + Bun
  uses: withvariablelab/gh-actions/actions/setup-pnpm-bun@main
```

## Requirements

- A `pnpm-lock.yaml` at the repository root, and a `packageManager` field in `package.json`.
- A `.bun-version` file at the repository root, with the Bun version to install. The action fails when the file is missing.

## What it does

It runs the whole pnpm flow: it installs pnpm, upgrades npm, caches the store and runs `pnpm install --frozen-lockfile --prefer-offline`. Then it installs Bun from `.bun-version`. At the end it logs the `pnpm`, `npm` and `bun` versions.
