# railway-redeploy

This action redeploys a Railway service through the Railway GraphQL API, and returns the service's URL in the Railway panel.

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
| `project_id` | yes | — | The ID of the Railway project the service is in. |
| `environment` | yes | — | The environment's name, such as `staging` or `production`. Case doesn't matter. |
| `service_name` | yes | — | The service's name as the Railway dashboard shows it. Case doesn't matter, and no service ID is needed. |
| `api_token` | yes | — | A Railway account or workspace token with access to the project. Project tokens don't work: the action sends `Authorization: Bearer`, and Railway expects a project token in a `Project-Access-Token` header. |
| `api_url` | no | `https://backboard.railway.com/graphql/v2` | Change it only to target a non-standard Railway endpoint. |

## Outputs

| Output | Description |
| --- | --- |
| `service_url` | The URL of the redeployed service in the Railway panel (`https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>`). |

## Requirements

- A Railway token in a secret, passed as `api_token` (see [Inputs](#inputs)).
- Nothing else. The action runs on the runner's Node 24 (`runs.using: node24`) from the committed, bundled `dist/index.js`. It needs no Bun, no Node or pnpm setup step, no dependency install, and no checkout: it never reads the repository.

## Required permissions

None from `GITHUB_TOKEN`: the action only talks to the Railway API, with `api_token`. Grant the job what its other steps need, such as `contents: read` for `actions/checkout`, or `permissions: {}` if they need nothing.

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

## How it works

The action finds the service from `project_id`, `environment` and `service_name`. It takes the most recent deployment in the `SUCCESS`, `SLEEPING` or `FAILED` state that is marked `canRedeploy`, and calls the `deploymentRedeploy` mutation on it. Because a failed deployment counts, the action can retry a broken deploy without a new commit.
