# setup-bun

This action installs [Bun](https://bun.sh) at the version in `.bun-version`, then logs the version it installed.

## Usage

```yml
- name: ⌛ Setup Bun
  uses: withvariablelab/gh-actions/actions/setup-bun@main
```

## Requirements

- A `.bun-version` file at the repository root, with the Bun version to install. The action fails when the file is missing.
