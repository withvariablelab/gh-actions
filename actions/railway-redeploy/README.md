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
| `api_token` | yes | — | Railway API token (account or team token with access to the project). |
| `api_url` | no | `https://backboard.railway.com/graphql/v2` | Override only if you target a non-standard Railway endpoint. |

## Outputs

| Output | Description |
| --- | --- |
| `service_url` | URL of the redeployed service in the Railway panel (`https://railway.com/project/<projectId>/service/<serviceId>?environmentId=<envId>`). |

## Requirements

Bun runtime — pair this step with [`setup-bun`](../setup-bun/README.md) in the calling workflow.

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
    steps:
      - name: ⬇️ Checkout repo
        uses: actions/checkout@v4

      - name: ⌛ Setup Bun
        uses: withvariablelab/gh-actions/actions/setup-bun@main

      - name: 🚀 Redeploy Railway
        id: redeploy
        uses: withvariablelab/gh-actions/actions/railway-redeploy@main
        with:
          project_id: ${{ vars.RAILWAY_PROJECT_ID }}
          api_token: ${{ secrets.RAILWAY_API_TOKEN }}
          environment: staging
          service_name: api

      - name: 🔗 Print URL
        run: echo "Redeployed → ${{ steps.redeploy.outputs.service_url }}"
```
