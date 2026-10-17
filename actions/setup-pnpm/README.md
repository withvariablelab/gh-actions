# Setup pnpm

> [!WARNING]
> **Deprecated.** Install node and pnpm with [mise](https://mise.jdx.dev) through [`jdx/mise-action`](https://github.com/jdx/mise-action) instead. It stays in place for the workflows that still use it. See [Migrating to mise](#migrating-to-mise).

## Migrating to mise

1. Declare the tools in `mise.toml` and turn on the lockfile:

   ```toml
   [env]
   _.path = ["{{config_root}}/node_modules/.bin"]

   [tools]
   node = "24"
   pnpm = "10.30.3" # the same version as packageManager in package.json

   [settings]
   lockfile = true
   ```

2. Generate `mise.lock` for every platform CI runs on (plus the ones your team develops on) and commit it:

   ```sh
   mise lock -p linux-x64,linux-x64-musl,linux-arm64,linux-arm64-musl,macos-x64,macos-arm64,windows-x64
   ```

3. Replace this action, `actions/setup-node` and `.node-version` with two steps:

   ```yml
   - name: 🛠️ Setup mise
     uses: jdx/mise-action@c2a87611a18de5b3828c5652fe268e992400cb5c # v4.3.0
     with:
       install: true
       cache: true

   - name: 📦 Install dependencies
     run: pnpm install --frozen-lockfile
   ```

Two behaviors of `jdx/mise-action` v4.3.0 matter here:

- When it finds a `mise.lock` (walking up from `working_directory`), it runs `mise install --locked`. That fails for any tool of any config the job loads that has no lockfile entry for the runner's platform, so every config needs a `mise.lock` that covers it (`linux-x64` on `ubuntu-latest`).
- It exports `[env] _.path` from `mise.toml` to later steps (input `export_path`, default `true`), so a `node_modules/.bin` entry there puts local binaries on `PATH`.

What this action did that the mise steps don't:

- **npm upgrade:** not needed. npm trusted publishing (OIDC) needs npm >= 11.5.1, and the npm bundled with the locked Node already has it (Node 24.21.0 ships npm 11.19.0).
- **pnpm store cache:** dropped. `cache: true` caches the tools mise installs, not the pnpm store.

## Deprecated behavior

The action prepares a pnpm-based workflow:

- Installs [pnpm](https://pnpm.io) via `pnpm/action-setup`
- Upgrades `npm` to an exact, hand-bumped 11.x (currently `11.21.0`, required for npm trusted publishing)
- Caches the pnpm store (keyed by month + `pnpm-lock.yaml` hash)
- Runs `pnpm install --frozen-lockfile --prefer-offline`
- Logs the resolved `pnpm` and `npm` versions

### Usage

```yml
- name: ⌛ Setup pnpm
  uses: withvariablelab/gh-actions/actions/setup-pnpm@main
```

### Requirements

- A `pnpm-lock.yaml` at the repository root (or wherever your job runs `pnpm install` from).
- A `packageManager` field in `package.json` (read by `pnpm/action-setup` to pick the pnpm version).
