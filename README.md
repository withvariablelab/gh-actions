# gh-actions

Reusable GitHub Actions for Variable Land.

## Actions

- [`preview-release`](actions/preview-release): publishes a per-PR preview release of a standalone library, a single package outside a workspace, to npm, with OIDC first and an optional `NPM_TOKEN` fallback. The PR comment comes from the [`vland-bot`](https://bot.variable.land) server (`mode: server`, the default) or from a separate job that never runs PR code (`mode: publish` and `mode: comment`, with [`preview-comment`](#reusable-workflows)).
- [`monorepo-preview-release`](actions/monorepo-preview-release): publishes a per-PR preview release of the changed packages in a pnpm monorepo to npm, with OIDC first and an optional `NPM_TOKEN` fallback. The PR comment comes from the [`vland-bot`](https://bot.variable.land) server (`mode: server`, the default) or from a separate job that never runs PR code (`mode: publish` and `mode: comment`, with [`preview-comment`](#reusable-workflows)).
- [`railway-redeploy`](actions/railway-redeploy): redeploys a Railway service through the Railway GraphQL API. It finds the service from `project_id`, `environment` and `service_name`, so it needs no service ID.
- [`setup-pnpm`](actions/setup-pnpm): installs pnpm, upgrades npm, caches the pnpm store and installs the dependencies. **Deprecated:** install node and pnpm with mise instead ([migration](actions/setup-pnpm/README.md#migrating-to-mise)).
- [`setup-bun`](actions/setup-bun): installs Bun at the version in `.bun-version`.
- [`setup-pnpm-bun`](actions/setup-pnpm-bun): `setup-pnpm` and `setup-bun` in one step, for workflows that need both runtimes. **Deprecated:** install node, pnpm and bun with mise instead ([migration](actions/setup-pnpm/README.md#migrating-to-mise)).

## Reusable workflows

- [`preview-comment`](.github/workflows/preview-comment.yml): job 2 of the two-job preview pattern. It mints a `vland-bot` token for the current repo, with `pull-requests: write`, and upserts the preview release's PR comment from the `packages` output of a `mode: publish` job, without checking out or running PR code. The setup and a caller example are in the [`preview-release`](actions/preview-release/README.md#two-job-previews) and [`monorepo-preview-release`](actions/monorepo-preview-release/README.md#two-job-previews) READMEs.

```yml
preview-comment:
  needs: preview
  permissions: {}
  uses: withvariablelab/gh-actions/.github/workflows/preview-comment.yml@main
  with:
    action: monorepo-preview-release # or preview-release
    packages: ${{ needs.preview.outputs.packages }}
  secrets:
    VLAND_BOT_PRIVATE_KEY: ${{ secrets.VLAND_BOT_PRIVATE_KEY }}
```

## Versioning

Pin an action to a tag or a commit SHA when you need stability:

```yml
uses: withvariablelab/gh-actions/actions/<action-name>@<tag-or-sha>
```

`@main` tracks the latest changes on the default branch.

## Contributing

The [contributing guide](docs/contributing.md) covers issues and pull requests, and the [development guide](docs/development.md) covers setting up the repo and running its checks.

## License

[MIT](LICENSE).

<p align="center">
  <a href="https://lab.variable.land"><img src="https://cdn.jsdelivr.net/gh/withvariablelab/brand@v0.3.1/.github/readme/logo.svg" width="24" alt="" align="absmiddle">&nbsp;Variable Land</a>
</p>
