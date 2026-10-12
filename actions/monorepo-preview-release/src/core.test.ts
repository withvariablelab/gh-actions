// Shared by preview-release and monorepo-preview-release: keep both copies
// byte-identical (CI diffs them).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ActionMode, PublishMode, parseActionMode, parsePublishMode } from "./core.ts";

describe("parseActionMode", () => {
  it("defaults to server, the behaviour before modes existed", () => {
    assert.equal(parseActionMode(""), ActionMode.SERVER);
  });

  for (const mode of ["server", "publish", "comment"]) {
    it(`accepts ${mode}`, () => {
      assert.equal(parseActionMode(mode), mode);
    });
  }

  for (const mode of ["Comment", "both", "comment "]) {
    it(`rejects ${JSON.stringify(mode)}`, () => {
      assert.throws(() => parseActionMode(mode), /Invalid mode/);
    });
  }
});

describe("parsePublishMode", () => {
  it("leaves detection on when empty", () => {
    assert.equal(parsePublishMode(""), undefined);
  });

  it("accepts oidc-only", () => {
    assert.equal(parsePublishMode("oidc-only"), PublishMode.OIDC_ONLY);
  });

  it("rejects unknown values", () => {
    assert.throws(() => parsePublishMode("npm-token"), /Invalid publish_mode/);
  });
});
