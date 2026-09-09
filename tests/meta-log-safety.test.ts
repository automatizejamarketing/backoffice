import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeMetaParams } from "../lib/observability/meta-logger";

test("omits customer-file members, hashes, schemas and samples from Meta observability", () => {
  assert.deepEqual(
    sanitizeMetaParams(new URLSearchParams({
      schema: '["EMAIL"]',
      data: '[["a secret hash"]]',
      num_received: "1",
    })),
    { schema: "[OMITTED]", data: "[OMITTED]", num_received: "1" },
  );
  assert.deepEqual(sanitizeMetaParams("schema=%5B%22EMAIL%22%5D&data=secret"), {
    schema: "[OMITTED]",
    data: "[OMITTED]",
  });
  assert.deepEqual(
    sanitizeMetaParams({ data: [["cliente@example.com"]], invalid_entries: ["cliente@example.com"] }),
    { data: "[OMITTED]", invalid_entries: "[OMITTED]" },
  );
});
