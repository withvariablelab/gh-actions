import path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { HttpClient } from "@actions/http-client";
import { BearerCredentialHandler } from "@actions/http-client/lib/auth";
import { parsePublishMode, release } from "./core.ts";

try {
  // Refuse `pull_request_target`. The trigger gives the workflow access to
  // base-branch secrets while the workflow can opt to check out the PR head;
  // combined with lifecycle scripts in `prepack`/`prepare`, that lets a fork
  // PR exfiltrate the publish credentials. `pull_request` is the right
  // trigger for this action — GitHub strips secrets for fork PRs there.
  if (github.context.eventName === "pull_request_target") {
    throw new Error(
      "This action refuses to run on `pull_request_target` (unsafe with PR head checkout + publish secrets). Use `on: pull_request` instead.",
    );
  }

  const npmToken = core.getInput("npm_token") || undefined;
  const workingDirectory = core.getInput("working_directory") || ".";
  const vlandBotUrl = core.getInput("vland_bot_url") || "https://bot.variable.land";
  const publishMode = parsePublishMode(core.getInput("publish_mode"));

  if (npmToken) core.setSecret(npmToken);

  const prNumber = github.context.payload.pull_request?.number;
  const latestCommitSha = github.context.payload.pull_request?.head?.sha;

  if (!prNumber) {
    throw new Error("PR number can not be determined");
  }

  if (!latestCommitSha) {
    throw new Error("Latest commit SHA can not be determined");
  }

  core.debug(`PR number: ${prNumber}`);
  core.debug(`Latest commit SHA: ${latestCommitSha}`);

  const { owner, repo } = github.context.repo;
  const workspaceDir = path.resolve(process.cwd(), workingDirectory);

  const packages = await release({
    workspaceDir,
    prNumber,
    latestCommitSha,
    npmToken,
    publishMode,
  });

  const oidcToken = await core.getIDToken("vland-bot");
  core.setSecret(oidcToken);

  const http = new HttpClient("preview-release", [new BearerCredentialHandler(oidcToken)], {
    allowRetries: true,
    maxRetries: 3,
  });

  const response = await http.postJson(`${vlandBotUrl}/v1/github/preview-release`, {
    owner,
    repo,
    prNumber,
    latestCommitSha,
    packages,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`vland-bot responded with ${response.statusCode}: ${JSON.stringify(response.result)}`);
  }
} catch (error) {
  core.setFailed(error as unknown as Error);
}
