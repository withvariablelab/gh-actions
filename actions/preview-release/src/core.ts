import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import * as core from "@actions/core";
import { formatError, getPackage, isPublishable, isUnpublished, type Package, runLogged } from "./utils.ts";

export type PublishResults = Array<{
  packageName: string;
  nextVersion: string;
  firstTime: boolean;
}>;

type Options = {
  workspaceDir?: string;
  prNumber: number;
  latestCommitSha: string;
  npmToken?: string;
};

const PublishMode = {
  OIDC_WITH_TOKEN_FALLBACK: "oidc-with-token-fallback",
  OIDC_ONLY: "oidc-only",
  TOKEN_ONLY: "token-only",
} as const;
type PublishMode = (typeof PublishMode)[keyof typeof PublishMode];

async function bumpPackage(pkg: Package, preid: string): Promise<string> {
  // --no-git-checks: pnpm version refuses to run on an unclean working tree
  // by default, and CI steps before this one may leave the tree dirty
  const result = await runLogged(
    "pnpm",
    ["version", "prerelease", "--preid", preid, "--no-git-tag-version", "--no-git-checks"],
    {
      cwd: pkg.path,
      group: `pnpm version: ${pkg.name}`,
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`pnpm version failed for ${pkg.name} (exit ${result.exitCode}): ${result.output}`);
  }
  const manifest = JSON.parse(await readFile(path.join(pkg.path, "package.json"), "utf8")) as { version: string };
  return manifest.version;
}

async function publishOnce(
  pkg: Package,
  tag: string,
  opts: { provenance?: boolean },
): Promise<{ ok: true } | { ok: false; stderr: string }> {
  const args = ["publish", "--tag", tag, "--access", "public", "--no-git-checks"];
  if (opts.provenance) args.push("--provenance");
  const label = opts.provenance ? `${pkg.name} (provenance)` : pkg.name;
  const result = await runLogged("pnpm", args, { cwd: pkg.path, group: `pnpm publish: ${label}` });
  if (result.exitCode === 0) return { ok: true };
  return { ok: false, stderr: result.output };
}

async function publishPackage(pkg: Package, tag: string, mode: PublishMode): Promise<void> {
  if (mode === PublishMode.TOKEN_ONLY) {
    const r = await publishOnce(pkg, tag, { provenance: false });
    if (!r.ok) throw new Error(`Failed to publish ${pkg.name}: ${r.stderr}`);
    return;
  }
  const r1 = await publishOnce(pkg, tag, { provenance: true });
  if (r1.ok) return;
  if (mode === PublishMode.OIDC_ONLY) {
    throw new Error(`Failed to publish ${pkg.name} (OIDC): ${r1.stderr}`);
  }
  // OIDC_WITH_TOKEN_FALLBACK: only fall back if the package itself has never
  // been published (Trusted Publisher needs an existing package).
  if (!(await isUnpublished(pkg.name))) {
    throw new Error(`Failed to publish ${pkg.name}: ${r1.stderr}`);
  }
  core.warning(
    `First-time publish detected for ${pkg.name}; falling back to NPM_TOKEN auth without provenance ` +
      `because no Trusted Publisher is configured yet.`,
  );
  const r2 = await publishOnce(pkg, tag, { provenance: false });
  if (!r2.ok) throw new Error(`Failed to publish ${pkg.name} (fallback): ${r2.stderr}`);
}

function detectMode(workspaceDir: string, hasNpmToken: boolean): PublishMode {
  const npmrcPath = path.join(workspaceDir, ".npmrc");
  if (existsSync(npmrcPath)) return PublishMode.TOKEN_ONLY;
  if (hasNpmToken) return PublishMode.OIDC_WITH_TOKEN_FALLBACK;
  return PublishMode.OIDC_ONLY;
}

// Wrap a callback with a transient ~/.npmrc auth line so `pnpm publish` can
// authenticate via NPM_TOKEN. Restores whatever was in $HOME/.npmrc before.
async function withNpmAuth<T>(npmToken: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!npmToken) return fn();
  const home = process.env.HOME;
  if (!home) return fn();
  const npmrcPath = path.join(home, ".npmrc");
  let prev: string | undefined;
  try {
    prev = await readFile(npmrcPath, "utf8");
  } catch {
    // file doesn't exist; we'll write a fresh one.
  }
  const authLine = `//registry.npmjs.org/:_authToken=${npmToken}\n`;
  await writeFile(npmrcPath, (prev ?? "") + authLine);
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      try {
        await unlink(npmrcPath);
      } catch {}
    } else {
      await writeFile(npmrcPath, prev);
    }
  }
}

export function getPublishTag(prNumber: number) {
  return `pr-${prNumber}`;
}

export async function release(options: Options): Promise<PublishResults> {
  const { workspaceDir = process.cwd(), prNumber, latestCommitSha, npmToken } = options;
  const mode = detectMode(workspaceDir, !!npmToken);
  core.debug(`mode: ${mode}, hasNpmToken: ${!!npmToken}`);

  return withNpmAuth(npmToken, async () => {
    const pkg = await getPackage(workspaceDir);

    if (!isPublishable(pkg)) {
      core.info(`Package ${pkg.name} is private; nothing to publish`);
      return [];
    }

    const firstTime = await isUnpublished(pkg.name);

    let nextVersion: string;
    try {
      const preid = `git-${latestCommitSha.substring(0, 7)}`;
      nextVersion = await bumpPackage(pkg, preid);
    } catch (cause) {
      throw new Error(`Failed to bump package: ${formatError(cause).message}`);
    }

    const tag = getPublishTag(prNumber);

    try {
      await publishPackage(pkg, tag, mode);
    } catch (cause) {
      throw new Error(`Failed to publish package: ${formatError(cause).message}`);
    }

    return [{ packageName: pkg.name, nextVersion, firstTime }];
  });
}
