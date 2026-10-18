import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

const REQUIRED_INPUTS = {
  project_id: "project",
  environment: "staging",
  service_name: "api",
  api_token: "token",
};

// Runs the entry point the way the runner does: the inputs arrive as INPUT_* variables,
// and the step's error is the `::error::` line on stdout.
function runAction(inputs: Record<string, string>) {
  const env = Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value]));

  return spawnSync(process.execPath, [path.join(import.meta.dirname, "index.ts")], { env, encoding: "utf8" });
}

describe("required inputs", () => {
  for (const name of Object.keys(REQUIRED_INPUTS)) {
    it(`fails the step with a clear message when ${name} is missing`, () => {
      const result = runAction(Object.fromEntries(Object.entries(REQUIRED_INPUTS).filter(([key]) => key !== name)));

      assert.equal(result.status, 1);
      assert.match(
        result.stdout,
        new RegExp(`^::error::🚨 Failed to redeploy railway service: Input required and not supplied: ${name}$`, "m"),
      );
    });
  }
});
