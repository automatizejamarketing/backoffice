import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

it("real frontend/backoffice handlers resolve policy independently of Meta cache and operator", () => {
  for (const app of ["frontend", "backoffice"]) {
    const result = spawnSync(process.execPath, [resolve(app === "backoffice" ? process.env.BACKOFFICE_ROOT! : process.env.FRONTEND_ROOT!, "tests/helpers/ai-duration-route-child.ts"), app], { env: process.env, encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, `${app}: ${result.stdout}\n${result.stderr}`);
  }
});
