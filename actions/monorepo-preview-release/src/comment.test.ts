// Shared by preview-release and monorepo-preview-release: keep both copies
// byte-identical (CI diffs them).

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  assertCommentEvent,
  assertEmptyWorkspace,
  botLoginFromAppSlug,
  buildCommentBody,
  COMMENT_TAG,
  type CommentOctokit,
  MAX_PACKAGES,
  MAX_PACKAGES_INPUT_LENGTH,
  parsePackages,
  runCommentMode,
  upsertComment,
} from "./comment.ts";

const HEAD_SHA = "abc1234def5678abc1234def5678abc1234def56";

const BOT_LOGIN = "vland-bot[bot]";

type FakeComment = { id: number; body: string; user: { login: string; type: string } };

function createFakeOctokit(existing: FakeComment[] = []) {
  const calls = {
    paginate: [] as Array<Record<string, unknown>>,
    update: [] as Array<Record<string, unknown>>,
    create: [] as Array<Record<string, unknown>>,
  };

  const listComments = () => {
    throw new Error("listComments must be called through paginate");
  };

  const fake = {
    paginate: async (route: unknown, params: Record<string, unknown>) => {
      assert.equal(route, listComments);
      calls.paginate.push(params);
      return existing;
    },
    rest: {
      issues: {
        listComments,
        updateComment: async (params: Record<string, unknown>) => {
          calls.update.push(params);
          return { data: { id: params.comment_id } };
        },
        createComment: async (params: Record<string, unknown>) => {
          calls.create.push(params);
          return { data: { id: 4242 } };
        },
      },
    },
  };

  return { octokit: fake as unknown as CommentOctokit, calls };
}

function totalCalls(calls: ReturnType<typeof createFakeOctokit>["calls"]) {
  return calls.paginate.length + calls.update.length + calls.create.length;
}

describe("buildCommentBody", () => {
  it("renders the empty state", () => {
    const body = buildCommentBody({ packages: [], prNumber: 7, headSha: HEAD_SHA });

    assert.equal(
      body,
      [COMMENT_TAG, "### Preview release", "", "Latest commit: `abc1234`", "", "No packages have been released."].join("\n"),
    );
  });

  it("renders the packages table with values in code spans", () => {
    const body = buildCommentBody({
      packages: [
        { packageName: "@variablelab/env", nextVersion: "0.6.0-git-abc1234.0", firstTime: false },
        { packageName: "dx", nextVersion: "1.0.0" },
      ],
      prNumber: 42,
      headSha: HEAD_SHA,
    });

    assert.equal(
      body,
      [
        COMMENT_TAG,
        "### Preview release",
        "",
        "Latest commit: `abc1234`",
        "",
        "Some packages have been released:",
        "| Package            | Version               | Install                                |",
        "| ------------------ | --------------------- | -------------------------------------- |",
        "| `@variablelab/env` | `0.6.0-git-abc1234.0` | `@variablelab/env@0.6.0-git-abc1234.0` |",
        "| `dx`               | `1.0.0`               | `dx@1.0.0`                             |",
        "",
        "> [!NOTE]",
        "> Use the PR number as tag to install any package. For instance:",
        "> ```",
        "> pnpm add @variablelab/env@pr-42",
        "> ```",
      ].join("\n"),
    );
  });

  it("starts with the marker so the comment can be found again", () => {
    const body = buildCommentBody({ packages: [{ packageName: "a", nextVersion: "1.0.0" }], prNumber: 1, headSha: HEAD_SHA });

    assert.ok(body.startsWith(`${COMMENT_TAG}\n`));
  });

  it("marks first-time publishes and adds the footnote", () => {
    const body = buildCommentBody({
      packages: [
        { packageName: "@variablelab/new", nextVersion: "0.0.1-git-abc1234.0", firstTime: true },
        { packageName: "@variablelab/old", nextVersion: "1.2.3-git-abc1234.0", firstTime: false },
      ],
      prNumber: 9,
      headSha: HEAD_SHA,
    });

    assert.match(body, /\| `@variablelab\/new` † \|/);
    assert.match(body, /\| `@variablelab\/old` {3}\|/);
    assert.ok(
      body.endsWith(
        "† First publish of this package — it has no `latest` tag yet, so install it via `@pr-9` or the exact version above (plain `pnpm add <package>` won't resolve it until a stable release).",
      ),
    );
  });

  it("omits the footnote when nothing is published for the first time", () => {
    const body = buildCommentBody({
      packages: [{ packageName: "a", nextVersion: "1.0.0", firstTime: false }],
      prNumber: 1,
      headSha: HEAD_SHA,
    });

    assert.ok(!body.includes("†"));
  });
});

describe("parsePackages", () => {
  it("accepts scoped and unscoped names, prereleases, build metadata and an optional firstTime", () => {
    const packages = [
      { packageName: "@variablelab/env", nextVersion: "0.6.0-git-abc1234.0", firstTime: true },
      { packageName: "@rrlab/cli", nextVersion: "1.3.0+build.5" },
      { packageName: "theme-toggle", nextVersion: "2.0.0-rc.1", firstTime: false },
      { packageName: "a.b_c~d", nextVersion: "0.0.0" },
    ];

    assert.deepEqual(parsePackages(JSON.stringify(packages)), packages);
  });

  it("accepts an empty list", () => {
    assert.deepEqual(parsePackages("[]"), []);
  });

  it(`accepts exactly ${MAX_PACKAGES} packages`, () => {
    const packages = Array.from({ length: MAX_PACKAGES }, (_, i) => ({ packageName: `pkg-${i}`, nextVersion: "1.0.0" }));

    assert.equal(parsePackages(JSON.stringify(packages)).length, MAX_PACKAGES);
  });

  const rejected: Array<[string, string]> = [
    ["empty input", ""],
    ["invalid JSON", "[{"],
    ["an object instead of an array", JSON.stringify({ packageName: "a", nextVersion: "1.0.0" })],
    ["null", "null"],
    ["a string entry", JSON.stringify(["a@1.0.0"])],
    [
      "more than the maximum",
      JSON.stringify(Array.from({ length: MAX_PACKAGES + 1 }, () => ({ packageName: "a", nextVersion: "1.0.0" }))),
    ],
    ["an unknown key", JSON.stringify([{ packageName: "a", nextVersion: "1.0.0", url: "https://evil.example" }])],
    ["a missing nextVersion", JSON.stringify([{ packageName: "a" }])],
    ["a missing packageName", JSON.stringify([{ nextVersion: "1.0.0" }])],
    ["a non-boolean firstTime", JSON.stringify([{ packageName: "a", nextVersion: "1.0.0", firstTime: "true" }])],
    ["an uppercase name", JSON.stringify([{ packageName: "React", nextVersion: "1.0.0" }])],
    ["a name with a space", JSON.stringify([{ packageName: "a b", nextVersion: "1.0.0" }])],
    ["a name with a backtick", JSON.stringify([{ packageName: "a`b", nextVersion: "1.0.0" }])],
    ["a name with a pipe", JSON.stringify([{ packageName: "a|b", nextVersion: "1.0.0" }])],
    ["a name with a newline", JSON.stringify([{ packageName: "a\nb", nextVersion: "1.0.0" }])],
    ["a name with markdown link syntax", JSON.stringify([{ packageName: "[x](https://evil.example)", nextVersion: "1.0.0" }])],
    ["a name with html", JSON.stringify([{ packageName: "<img>", nextVersion: "1.0.0" }])],
    ["a name starting with a dot", JSON.stringify([{ packageName: ".hidden", nextVersion: "1.0.0" }])],
    ["a name starting with an underscore", JSON.stringify([{ packageName: "_private", nextVersion: "1.0.0" }])],
    ["a scope without a name", JSON.stringify([{ packageName: "@scope/", nextVersion: "1.0.0" }])],
    ["a nested path", JSON.stringify([{ packageName: "@scope/a/b", nextVersion: "1.0.0" }])],
    ["a name over 214 characters", JSON.stringify([{ packageName: "a".repeat(215), nextVersion: "1.0.0" }])],
    ["a two-part version", JSON.stringify([{ packageName: "a", nextVersion: "1.0" }])],
    ["a v-prefixed version", JSON.stringify([{ packageName: "a", nextVersion: "v1.0.0" }])],
    ["a version with a leading zero", JSON.stringify([{ packageName: "a", nextVersion: "01.0.0" }])],
    ["a version with markdown", JSON.stringify([{ packageName: "a", nextVersion: "1.0.0-`x`" }])],
    ["a numeric version", JSON.stringify([{ packageName: "a", nextVersion: 1 }])],
    ["an oversized input", " ".repeat(MAX_PACKAGES_INPUT_LENGTH + 1)],
  ];

  for (const [label, raw] of rejected) {
    it(`rejects ${label}`, () => {
      assert.throws(() => parsePackages(raw), /Invalid "packages" input/);
    });
  }

  it("never echoes the rejected input in the error", () => {
    const raw = JSON.stringify([{ packageName: "::add-mask::LEAK", nextVersion: "1.0.0", "::error::LEAK": true }]);

    assert.throws(
      () => parsePackages(raw),
      (error: Error) => !error.message.includes("LEAK") && error.message.includes("0.packageName"),
    );
  });
});

describe("assertCommentEvent", () => {
  it("allows pull_request", () => {
    assert.doesNotThrow(() => assertCommentEvent("pull_request"));
  });

  for (const eventName of ["pull_request_target", "workflow_run"]) {
    it(`refuses ${eventName}`, () => {
      assert.throws(() => assertCommentEvent(eventName), new RegExp(`refuses to run on \`${eventName}\``));
    });
  }
});

describe("assertEmptyWorkspace", () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "preview-comment-"));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("passes for an empty workspace", async () => {
    const dir = path.join(root, "empty");
    await mkdir(dir);

    await assert.doesNotReject(assertEmptyWorkspace(dir));
  });

  it("passes when the workspace does not exist yet", async () => {
    await assert.doesNotReject(assertEmptyWorkspace(path.join(root, "missing")));
  });

  it("refuses a workspace with files", async () => {
    const dir = path.join(root, "checked-out");
    await mkdir(dir);
    await writeFile(path.join(dir, "package.json"), "{}");

    await assert.rejects(assertEmptyWorkspace(dir), /GITHUB_WORKSPACE has 1 entries/);
  });

  it("refuses a workspace with only hidden entries", async () => {
    const dir = path.join(root, "hidden");
    await mkdir(path.join(dir, ".git"), { recursive: true });

    await assert.rejects(assertEmptyWorkspace(dir), /GITHUB_WORKSPACE has 1 entries/);
  });

  it("refuses when GITHUB_WORKSPACE is not set", async () => {
    await assert.rejects(assertEmptyWorkspace(undefined), /GITHUB_WORKSPACE is not set/);
    await assert.rejects(assertEmptyWorkspace(""), /GITHUB_WORKSPACE is not set/);
  });
});

describe("botLoginFromAppSlug", () => {
  it("maps an app slug to its bot login", () => {
    assert.equal(botLoginFromAppSlug("vland-bot"), "vland-bot[bot]");
    assert.equal(botLoginFromAppSlug("a1"), "a1[bot]");
  });

  it("rejects anything that is not an app slug", () => {
    for (const slug of ["", "Vland-bot", "vland-bot[bot]", "-bot", "vland bot", "vland_bot", "a".repeat(101)]) {
      assert.throws(() => botLoginFromAppSlug(slug), /Invalid "app_slug" input/, JSON.stringify(slug));
    }
  });
});

describe("upsertComment", () => {
  const target = { owner: "withvariablelab", repo: "dx", prNumber: 12 };

  it("creates the comment when none exists", async () => {
    const { octokit, calls } = createFakeOctokit([
      { id: 1, body: "LGTM", user: { login: "rqbazan", type: "User" } },
      { id: 2, body: "unrelated bot comment", user: { login: "changeset-bot[bot]", type: "Bot" } },
    ]);

    const result = await upsertComment(octokit, target, "new body", BOT_LOGIN);

    assert.deepEqual(result, { action: "created", commentId: 4242 });
    assert.deepEqual(calls.paginate, [{ owner: "withvariablelab", repo: "dx", issue_number: 12, per_page: 100 }]);
    assert.deepEqual(calls.create, [{ owner: "withvariablelab", repo: "dx", issue_number: 12, body: "new body" }]);
    assert.deepEqual(calls.update, []);
  });

  it("updates the existing bot comment that carries the marker", async () => {
    const { octokit, calls } = createFakeOctokit([
      { id: 1, body: "LGTM", user: { login: "rqbazan", type: "User" } },
      { id: 77, body: `${COMMENT_TAG}\n### Preview release`, user: { login: "vland-bot[bot]", type: "Bot" } },
    ]);

    const result = await upsertComment(octokit, target, "new body", BOT_LOGIN);

    assert.deepEqual(result, { action: "updated", commentId: 77 });
    assert.deepEqual(calls.update, [{ owner: "withvariablelab", repo: "dx", comment_id: 77, body: "new body" }]);
    assert.deepEqual(calls.create, []);
  });

  it("ignores a human comment that quotes the marker", async () => {
    const { octokit, calls } = createFakeOctokit([
      { id: 5, body: `look: ${COMMENT_TAG}`, user: { login: "someone", type: "User" } },
    ]);

    const result = await upsertComment(octokit, target, "new body", BOT_LOGIN);

    assert.equal(result.action, "created");
    assert.deepEqual(calls.update, []);
    assert.equal(calls.create.length, 1);
  });

  it("ignores another bot's comment that quotes the marker", async () => {
    const { octokit, calls } = createFakeOctokit([
      { id: 6, body: `${COMMENT_TAG}\nquoted`, user: { login: "changeset-bot[bot]", type: "Bot" } },
      { id: 7, body: `${COMMENT_TAG}\nquoted`, user: { login: "github-actions[bot]", type: "Bot" } },
    ]);

    const result = await upsertComment(octokit, target, "new body", BOT_LOGIN);

    assert.deepEqual(result, { action: "created", commentId: 4242 });
    assert.deepEqual(calls.update, []);
    assert.equal(calls.create.length, 1);
  });

  it("updates our own comment even when another bot quoted the marker first", async () => {
    const { octokit, calls } = createFakeOctokit([
      { id: 6, body: `${COMMENT_TAG}\nquoted`, user: { login: "changeset-bot[bot]", type: "Bot" } },
      { id: 77, body: `${COMMENT_TAG}\n### Preview release`, user: { login: "vland-bot[bot]", type: "Bot" } },
    ]);

    const result = await upsertComment(octokit, target, "new body", BOT_LOGIN);

    assert.deepEqual(result, { action: "updated", commentId: 77 });
    assert.deepEqual(calls.update, [{ owner: "withvariablelab", repo: "dx", comment_id: 77, body: "new body" }]);
    assert.deepEqual(calls.create, []);
  });

  it("requires a Bot account, not just a matching login", async () => {
    const { octokit, calls } = createFakeOctokit([
      { id: 8, body: `${COMMENT_TAG}\n### Preview release`, user: { login: "vland-bot[bot]", type: "User" } },
    ]);

    const result = await upsertComment(octokit, target, "new body", BOT_LOGIN);

    assert.equal(result.action, "created");
    assert.deepEqual(calls.update, []);
  });
});

describe("runCommentMode", () => {
  let root: string;
  let emptyWorkspace: string;
  let dirtyWorkspace: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "preview-comment-run-"));
    emptyWorkspace = path.join(root, "empty");
    dirtyWorkspace = path.join(root, "dirty");
    await mkdir(emptyWorkspace);
    await mkdir(dirtyWorkspace);
    await writeFile(path.join(dirtyWorkspace, "index.js"), "");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const baseOptions = {
    appSlug: "vland-bot",
    owner: "withvariablelab",
    repo: "theme-toggle",
    prNumber: 3,
    headSha: HEAD_SHA,
    eventName: "pull_request",
    rawPackages: JSON.stringify([
      { packageName: "@variablelab/theme-toggle", nextVersion: "2.0.0-git-abc1234.0", firstTime: false },
    ]),
  };

  it("validates, renders and upserts", async () => {
    const { octokit, calls } = createFakeOctokit();

    const result = await runCommentMode({ ...baseOptions, workspaceDir: emptyWorkspace, getOctokit: () => octokit });

    assert.equal(result.action, "created");
    assert.equal(calls.create.length, 1);
    const body = String(calls.create[0]?.body);
    assert.ok(body.startsWith(COMMENT_TAG));
    assert.ok(body.includes("`@variablelab/theme-toggle@2.0.0-git-abc1234.0`"));
    assert.ok(body.includes("> pnpm add @variablelab/theme-toggle@pr-3"));
  });

  it("refuses a non-empty workspace before touching the API", async () => {
    let created = false;
    const { octokit, calls } = createFakeOctokit();

    await assert.rejects(
      runCommentMode({
        ...baseOptions,
        workspaceDir: dirtyWorkspace,
        getOctokit: () => {
          created = true;
          return octokit;
        },
      }),
      /GITHUB_WORKSPACE has 1 entries/,
    );
    assert.equal(created, false);
    assert.equal(totalCalls(calls), 0);
  });

  it("refuses a forbidden event before touching the API", async () => {
    const { octokit, calls } = createFakeOctokit();

    await assert.rejects(
      runCommentMode({ ...baseOptions, eventName: "workflow_run", workspaceDir: emptyWorkspace, getOctokit: () => octokit }),
      /refuses to run on `workflow_run`/,
    );
    assert.equal(totalCalls(calls), 0);
  });

  it("updates the comment of the app named by appSlug", async () => {
    const { octokit, calls } = createFakeOctokit([
      { id: 9, body: `${COMMENT_TAG}\nold`, user: { login: "other-app[bot]", type: "Bot" } },
      { id: 10, body: `${COMMENT_TAG}\nold`, user: { login: "vland-bot[bot]", type: "Bot" } },
    ]);

    const result = await runCommentMode({ ...baseOptions, workspaceDir: emptyWorkspace, getOctokit: () => octokit });

    assert.deepEqual(result, { action: "updated", commentId: 10 });
    assert.equal(calls.update.length, 1);
  });

  it("refuses an invalid app slug before touching the API", async () => {
    let created = false;
    const { octokit, calls } = createFakeOctokit();

    await assert.rejects(
      runCommentMode({
        ...baseOptions,
        appSlug: "vland-bot[bot]",
        workspaceDir: emptyWorkspace,
        getOctokit: () => {
          created = true;
          return octokit;
        },
      }),
      /Invalid "app_slug" input/,
    );
    assert.equal(created, false);
    assert.equal(totalCalls(calls), 0);
  });

  it("refuses invalid packages before touching the API", async () => {
    const { octokit, calls } = createFakeOctokit();

    await assert.rejects(
      runCommentMode({
        ...baseOptions,
        rawPackages: JSON.stringify([{ packageName: "@evil/x", nextVersion: "1.0.0) [click](https://evil.example" }]),
        workspaceDir: emptyWorkspace,
        getOctokit: () => octokit,
      }),
      /Invalid "packages" input/,
    );
    assert.equal(totalCalls(calls), 0);
  });
});
