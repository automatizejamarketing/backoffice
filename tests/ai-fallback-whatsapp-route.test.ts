import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const niche of ["retail", "real_estate_broker", "service", "insurance_broker", "outros"]) {
  it(`real backoffice WhatsApp fallback supports ${niche} with customer dates and budget`, () => {
    const result = spawnSync(process.execPath, [
      resolve(root, "tests/helpers/ai-fallback-whatsapp-route-child.ts"), niche,
    ], {
      cwd: root,
      env: {
        ...process.env,
        POSTGRES_URL: "postgres://test:test@127.0.0.1:1/test",
        STRIPE_SECRET_KEY: "sk_test_dummy",
        REDIS_URL: "",
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
        META_GENERAL_APP_SECRET: "test-app-secret",
        BYPASS_STRIPE: "false",
        DISABLE_EVE: "true",
        DISABLE_WORKFLOW: "true",
      },
      encoding: "utf8",
      timeout: 60000,
    });
    assert.equal(result.status, 0, `${niche}: ${result.stdout}\n${result.stderr}`);
  });
}
