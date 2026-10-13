# Setup Bun

GitHub Action that installs [Bun](https://bun.sh) pinned to the version declared in `.bun-version`, then logs the resolved version.

## Requirements

- A `.bun-version` file at the repository root containing the Bun version to install. The action fails fast if the file is missing.

## Usage

```yml
- name: ⌛ Setup Bun
  uses: withvariablelab/gh-actions/actions/setup-bun@main
```
