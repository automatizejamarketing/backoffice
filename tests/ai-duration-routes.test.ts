import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ownApp = existsSync(resolve(ownRoot, "app/api/meta-marketing")) ? "backoffice" : "frontend";
const roots: Record<string, string | undefined> = {};
for (const app of ["frontend", "backoffice"]) {
  const explicit = process.env[app === "frontend" ? "FRONTEND_ROOT" : "BACKOFFICE_ROOT"];
  const candidate = explicit ? resolve(explicit) : app === ownApp
    ? ownRoot : resolve(ownRoot, "..", app === "frontend" ? "automatize-frontend" : "backoffice");
  const available = existsSync(resolve(candidate, "tests/helpers/ai-duration-route-child.ts"));
  if (explicit) assert.ok(available, `${app} explicit test root must contain the duration route helper`);
  if (app === ownApp) {
    assert.ok(available, "Own duration route helper must exist; own handlers cannot be skipped");
    assert.equal(candidate.toLowerCase(), ownRoot.toLowerCase(), "Own handlers must run from this checkout");
  }
  roots[app] = available ? candidate : undefined;
}

for (const app of [ownApp, ownApp === "frontend" ? "backoffice" : "frontend"]) {
  it(`real ${app} handlers resolve policy independently of Meta cache and operator`, { skip: !roots[app] && `Paired ${app} checkout unavailable; own handlers still run` }, () => {
    const root = roots[app]!;
    const result = spawnSync(process.execPath, [resolve(root, "tests/helpers/ai-duration-route-child.ts"), app], {
      cwd: root,
      env: {
        ...process.env,
        FRONTEND_ROOT: roots.frontend ?? "",
        BACKOFFICE_ROOT: roots.backoffice ?? "",
        POSTGRES_URL: "postgres://test:test@127.0.0.1:1/test",
        STRIPE_SECRET_KEY: "sk_test_dummy",
        REDIS_URL: "",
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
        BYPASS_STRIPE: "false",
        DISABLE_EVE: "true",
        DISABLE_WORKFLOW: "true",
      },
      encoding: "utf8", timeout: 60000,
    });
    assert.equal(result.status, 0, `${app}: ${result.stdout}\n${result.stderr}`);
  });
}
