# Setup pnpm

GitHub Action that prepares a pnpm-based workflow:

- Installs [pnpm](https://pnpm.io) via `pnpm/action-setup`
- Upgrades `npm` to an exact, hand-bumped 11.x (currently `11.21.0`, required for npm trusted publishing)
- Caches the pnpm store (keyed by month + `pnpm-lock.yaml` hash)
- Runs `pnpm install --frozen-lockfile --prefer-offline`
- Logs the resolved `pnpm` and `npm` versions

## Usage

```yml
- name: ⌛ Setup pnpm
  uses: withvariablelab/gh-actions/actions/setup-pnpm@main
```

## Requirements

- A `pnpm-lock.yaml` at the repository root (or wherever your job runs `pnpm install` from).
- A `packageManager` field in `package.json` (read by `pnpm/action-setup` to pick the pnpm version).
