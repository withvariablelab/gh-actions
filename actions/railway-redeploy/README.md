# Railway redeploy

GitHub Action that triggers a redeploy of a Railway service via the Railway GraphQL API.

The action looks up the target service from `project_id` + `environment` + `service_name`, finds the most recent deployment in `SUCCESS`, `SLEEPING`, or `FAILED` state that is marked `canRedeploy`, and calls the `deploymentRedeploy` mutation. It returns the Railway panel URL of the redeployed service as an output, and (because failed deployments are eligible) it can be used to retry a broken deploy without having to push a new commit.

## Usage

```yml
- name: 🚀 Redeploy Railway
  uses: withvariablelab/gh-actions/actions/railway-redeploy@main
  with:
    project_id: ${{ vars.RAILWAY_PROJECT_ID }}
    api_token: ${{ secrets.RAILWAY_API_TOKEN }}
    environment: staging
    service_name: api
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `project_id` | yes | — | Railway project ID where the service lives. |
| `environment` | yes | — | Environment name (case-insensitive), e.g. `staging`, `production`. |
| `service_name` | yes | — | Service name as shown in the Railway dashboard (case-insensitive). No service ID is needed. |
| `api_token` | yes | — | Railway account or workspace token with access to the project. Project tokens don't work: the action sends `Authorization: Bearer`, and Railway expects project tokens in a `Project-Access-Token` header. |
| `api_url` | no | `https://backboard.railway.com/graphql/v2` | Override only if you target a non-standard Railway endpoint. |

## Outputs

| Output | Description |
| --- | --- |
| `service_url` | URL of the redeployed service in the Railway panel (`https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>`). |

## Required permissions

None from `GITHUB_TOKEN`: the action only talks to the Railway API, with `api_token`. Grant the job whatever its other steps need, e.g. `contents: read` for `actions/checkout`, or `permissions: {}` if it has none.

## Requirements

- A Railway token in a secret, passed as `api_token` (see [Inputs](#inputs)).
- Nothing else. The action runs on the runner's Node 24 (`runs.using: node24`) from the committed, bundled `dist/index.js`. It needs no Bun, no Node or pnpm setup step, no dependency install, and no checkout: it never reads the repository.

## Example

```yml
name: CI/CD

on:
  push:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # other steps like test and build

  deploy-to-stage:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read # for actions/checkout
    steps:
      # Only for your own steps that read the repo; railway-redeploy doesn't need it.
      - name: ⬇️ Checkout repo
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - name: 🚀 Redeploy Railway
        id: redeploy
        uses: withvariablelab/gh-actions/actions/railway-redeploy@main
        with:
          project_id: ${{ vars.RAILWAY_PROJECT_ID }}
          api_token: ${{ secrets.RAILWAY_API_TOKEN }}
          environment: staging
          service_name: api

      - name: 🔗 Print URL
        env:
          SERVICE_URL: ${{ steps.redeploy.outputs.service_url }}
        run: echo "Redeployed → $SERVICE_URL"
```
