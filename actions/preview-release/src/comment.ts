// Comment mode: upsert the preview-release PR comment from a job that never
// runs PR code. Ported from vland-bot (src/modules/github/services/
// preview-release.ts) so the comment keeps the same marker and layout.
//
// This file is shared by preview-release and monorepo-preview-release and
// must stay byte-identical in both (CI diffs them).
//
// It is pure on purpose: no @actions/* imports, so the security checks and
// the rendering are unit-testable with a fake Octokit.

import { readdir } from "node:fs/promises";
import { markdownTable } from "markdown-table";
import * as z from "zod";
import type { Octokit } from "./types.ts";

export const COMMENT_TAG = "<!-- preview-release-bot -->";

export const MAX_PACKAGES = 100;

// The `packages` input comes from a job that ran PR code, so it is untrusted.
// Cap its size before parsing it.
export const MAX_PACKAGES_INPUT_LENGTH = 64 * 1024;

// npm package names as validate-npm-package-name accepts them for new
// packages: lowercase, URL-safe characters only, optional scope, no leading
// "." or "_", at most 214 characters.
const PACKAGE_NAME_RE = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const PackageSchema = z.strictObject({
  packageName: z.string().max(214).regex(PACKAGE_NAME_RE),
  nextVersion: z.string().max(256).regex(SEMVER_RE),
  firstTime: z.boolean().optional(),
});

export const PackagesSchema = z.array(PackageSchema).max(MAX_PACKAGES);

export type PreviewPackage = z.infer<typeof PackageSchema>;

// GitHub App slugs are lowercase letters, digits and hyphens (GitHub derives
// them from the app name). The app's bot account logs in as `<slug>[bot]`.
const APP_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

// Events where the workflow runs with base-branch privileges on behalf of
// untrusted code. The comment job has no reason to run on them.
const FORBIDDEN_EVENTS = new Set(["pull_request_target", "workflow_run"]);

export type CommentOctokit = Pick<Octokit, "paginate"> & {
  rest: {
    issues: Pick<Octokit["rest"]["issues"], "listComments" | "updateComment" | "createComment">;
  };
};

export type CommentTarget = {
  owner: string;
  repo: string;
  prNumber: number;
};

export type UpsertResult = {
  action: "created" | "updated";
  commentId: number;
};

// The comment is matched by its exact author, so the token's own app is the
// only account whose comment can be picked for an update.
export function botLoginFromAppSlug(appSlug: string): string {
  if (!APP_SLUG_RE.test(appSlug)) {
    throw new Error('Invalid "app_slug" input: expected a GitHub App slug (lowercase letters, digits and hyphens).');
  }
  return `${appSlug}[bot]`;
}

export function assertCommentEvent(eventName: string): void {
  if (FORBIDDEN_EVENTS.has(eventName)) {
    throw new Error(
      `Comment mode refuses to run on \`${eventName}\`. Call it from a workflow triggered by \`pull_request\`, in a job that \`needs\` the publish job.`,
    );
  }
}

// The comment job must not check out or build PR code. A non-empty
// GITHUB_WORKSPACE means something did, so stop before using the token.
export async function assertEmptyWorkspace(workspaceDir: string | undefined): Promise<void> {
  if (!workspaceDir) {
    throw new Error("GITHUB_WORKSPACE is not set; refusing to run comment mode.");
  }

  let entries: string[];
  try {
    entries = await readdir(workspaceDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  if (entries.length > 0) {
    throw new Error(
      `Comment mode must run in a job that never checks out or runs PR code, but GITHUB_WORKSPACE has ${entries.length} ` +
        "entries. Remove the checkout (and any other step that writes to the workspace) from this job.",
    );
  }
}

// Parse and validate the untrusted `packages` input. Error messages name the
// failing paths and zod issue codes only, never the input itself: echoing
// attacker-controlled text to the log could inject workflow commands.
export function parsePackages(raw: string): PreviewPackage[] {
  if (raw.length > MAX_PACKAGES_INPUT_LENGTH) {
    throw new Error(`Invalid "packages" input: ${raw.length} characters (max ${MAX_PACKAGES_INPUT_LENGTH}).`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('Invalid "packages" input: not valid JSON.');
  }

  const result = PackagesSchema.safeParse(json);

  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.length ? issue.path.map(String).join(".") : "(root)"}: ${issue.code}`)
      .join("; ");
    throw new Error(`Invalid "packages" input: ${issues}.`);
  }

  return result.data;
}

function getPublishTag(prNumber: number) {
  return `pr-${prNumber}`;
}

// Values are rendered inside code spans so a package name can never become a
// link, a mention or markup. The schema already forbids backticks and pipes.
function code(value: string) {
  return `\`${value}\``;
}

export function buildCommentBody(params: { packages: PreviewPackage[]; prNumber: number; headSha: string }): string {
  const { packages, prNumber, headSha } = params;
  const shortSha = headSha.substring(0, 7);

  if (!packages.length) {
    return [
      COMMENT_TAG,
      "### Preview release",
      "",
      `Latest commit: ${code(shortSha)}`,
      "",
      "No packages have been released.",
    ].join("\n");
  }

  const firstPkg = packages[0];
  const publishTag = getPublishTag(prNumber);
  const hasFirstTime = packages.some((pkg) => pkg.firstTime);

  const lines = [
    COMMENT_TAG,
    "### Preview release",
    "",
    `Latest commit: ${code(shortSha)}`,
    "",
    "Some packages have been released:",
    markdownTable([
      ["Package", "Version", "Install"],
      ...packages.map(({ packageName, nextVersion, firstTime }) => [
        firstTime ? `${code(packageName)} †` : code(packageName),
        code(nextVersion),
        code(`${packageName}@${nextVersion}`),
      ]),
    ]),
    "",
    "> [!NOTE]",
    "> Use the PR number as tag to install any package. For instance:",
    "> ```",
    `> pnpm add ${firstPkg?.packageName}@${publishTag}`,
    "> ```",
  ];

  if (hasFirstTime) {
    lines.push(
      "",
      `† First publish of this package — it has no \`latest\` tag yet, so install it via \`@${publishTag}\` or the exact version above (plain \`pnpm add <package>\` won't resolve it until a stable release).`,
    );
  }

  return lines.join("\n");
}

// Update the existing preview comment or create one. Only a marker comment
// written by `botLogin` (the bot account of the app whose token we hold) is
// picked for an update. A human, or another bot such as changeset-bot, that
// quotes the marker is ignored: the app token could not edit that comment
// anyway, and trying would fail the job with a 403 on every run.
export async function upsertComment(
  octokit: CommentOctokit,
  target: CommentTarget,
  body: string,
  botLogin: string,
): Promise<UpsertResult> {
  const { owner, repo, prNumber } = target;

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existingComment = comments.find(
    (comment) => comment.user?.type === "Bot" && comment.user.login === botLogin && comment.body?.includes(COMMENT_TAG),
  );

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body,
    });
    return { action: "updated", commentId: existingComment.id };
  }

  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return { action: "created", commentId: data.id };
}

export type CommentModeOptions = CommentTarget & {
  appSlug: string;
  eventName: string;
  workspaceDir: string | undefined;
  headSha: string;
  rawPackages: string;
  getOctokit: () => CommentOctokit;
};

// Every check runs before the token is used.
export async function runCommentMode(options: CommentModeOptions): Promise<UpsertResult> {
  assertCommentEvent(options.eventName);
  await assertEmptyWorkspace(options.workspaceDir);
  const botLogin = botLoginFromAppSlug(options.appSlug);

  const packages = parsePackages(options.rawPackages);
  const body = buildCommentBody({ packages, prNumber: options.prNumber, headSha: options.headSha });

  const { owner, repo, prNumber } = options;
  return upsertComment(options.getOctokit(), { owner, repo, prNumber }, body, botLogin);
}
