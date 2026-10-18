/** biome-ignore-all lint/style/noNonNullAssertion: ensure by action itself */
import * as core from "@actions/core";
import { Client, fetchExchange } from "@urql/core";

type Deployments = {
  deployments: {
    edges: Array<{
      node: Deployment;
    }>;
  };
};

type Deployment = {
  id: string;
  projectId: string;
  serviceId: string;
  environmentId: string;
  canRedeploy?: boolean;
  status: "SUCCESS" | "SLEEPING" | "FAILED" | string;
};

type Environments = {
  environments: {
    edges: Array<{
      node: Environment;
    }>;
  };
};

type Environment = {
  id: string;
  name: string;
  serviceInstances: {
    edges: Array<{
      node: {
        id: string;
        serviceId: string;
        serviceName: string;
      };
    }>;
  };
};

const eqString = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function main() {
  const projectId = core.getInput("project_id", { required: true });
  const environment = core.getInput("environment", { required: true });
  const serviceName = core.getInput("service_name", { required: true });
  const apiToken = core.getInput("api_token", { required: true });
  const apiUrl = core.getInput("api_url") || "https://backboard.railway.com/graphql/v2";

  const gqlClient = new Client({
    url: apiUrl,
    exchanges: [fetchExchange],
    preferGetMethod: false,
    fetchOptions: {
      headers: { authorization: `Bearer ${apiToken}` },
    },
  });

  async function getEnviromentServices(envName: string) {
    const document = `#graphql
      query getEnviromentServices($projectId: String!) {
        environments(
          projectId: $projectId
          isEphemeral: false
        )  {
          edges {
            node {
              id
              name
              serviceInstances(
                first: 100
              ) {
                edges {
                  node {
                    id
                    serviceId
                    serviceName
                  }
                }
              }
            }
          }
        }
      }
    `;

    const { data, error } = await gqlClient.query<Environments>(document, { projectId }).toPromise();

    if (error) {
      throw new Error(`Cannot fetch environments: ${error.message}`);
    }

    if (!data?.environments?.edges?.length) {
      throw new Error(`No environments found in the project: ${projectId}`);
    }

    const envEdge = data?.environments?.edges?.find(({ node: env }) => eqString(env.name, envName));

    if (!envEdge?.node?.serviceInstances?.edges?.length) {
      throw new Error(`No services found in environment: ${envName}`);
    }

    return envEdge?.node ?? null;
  }

  async function getLastActiveOrSleepingOrFailedDeployment(serviceId: string, environmentId: string) {
    const document = `#graphql
      query getLastDeployment($serviceId: String!, $environmentId: String!) {
        deployments(first: 100, input: {
          serviceId: $serviceId
          environmentId: $environmentId
          status: { in: [SUCCESS, SLEEPING, FAILED] }
        }) {
          edges {
            node {
              id
              projectId
              environmentId
              serviceId
              canRedeploy
              status
            }
          }
        }
      }
    `;

    const { data, error } = await gqlClient.query<Deployments>(document, { serviceId, environmentId }).toPromise();

    if (error) {
      throw new Error(`Cannot fetch deployments: ${error.message}`);
    }

    if (!data?.deployments?.edges?.length) {
      throw new Error("No active, sleeping, or failed deployments found");
    }

    const edge = data?.deployments?.edges?.find(
      ({ node: d }) => (d.status === "SUCCESS" || d.status === "SLEEPING" || d.status === "FAILED") && !!d.canRedeploy,
    );

    return edge?.node ?? null;
  }

  async function deploymentRedeploy(deploymentId: string) {
    const document = `#graphql
      mutation redeploy($deploymentId: String!) {
        deploymentRedeploy(id: $deploymentId) {
          id
        }
      }
    `;

    const { error } = await gqlClient.mutation(document, { deploymentId }).toPromise();

    if (error) {
      throw new Error(`Cannot redeploy deployment: ${error.message}`);
    }
  }

  function getServicePanelUrl(deployment: Deployment) {
    return `https://railway.com/project/${deployment.projectId}/service/${deployment.serviceId}?environmentId=${deployment.environmentId}`;
  }

  const envWithServices = await getEnviromentServices(environment);

  if (!envWithServices) {
    throw new Error(`Environment "${environment}" not found`);
  }

  const serviceInstance = envWithServices.serviceInstances.edges.find((it) => eqString(it.node.serviceName, serviceName));

  if (!serviceInstance) {
    throw new Error(`Service "${serviceName}" not found in environment "${environment}"`);
  }

  const deployment = await getLastActiveOrSleepingOrFailedDeployment(serviceInstance.node.serviceId, envWithServices.id);

  if (!deployment) {
    throw new Error("No active, sleeping, or failed deployments found");
  }

  await deploymentRedeploy(deployment.id);

  const serviceUrl = getServicePanelUrl(deployment);

  core.info(`🚀 Deployment (ID: ${deployment.id}) redeploy launched: ${serviceUrl}`);

  core.setOutput("service_url", serviceUrl);
}

// The catch sits on the call so that everything main() throws, a missing input included, reaches setFailed.
main().catch((error) => {
  const msg = "Failed to redeploy railway service";

  if (error instanceof Error) {
    core.setFailed(`🚨 ${msg}: ${error.message}`);
  } else {
    core.setFailed(`🚨 ${msg}`);
  }
});
