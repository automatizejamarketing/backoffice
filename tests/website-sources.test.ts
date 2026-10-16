import assert from "node:assert/strict";
import { before, test } from "node:test";
import { mock } from "bun:test";

import { ensureMetaTestEnv, installMetaFetchStub } from "./helpers/meta-fetch-stub";

ensureMetaTestEnv();
mock.module("server-only", () => ({}));

let discoverWebsiteSources: typeof import("../lib/meta-business/marketing/audiences/website-sources").discoverWebsiteSources;
before(async () => {
  ({ discoverWebsiteSources } = await import("../lib/meta-business/marketing/audiences/website-sources"));
});

test("offers every event the Pixel received, including Conversions API (server) events", async () => {
  // A store that sends Purchase only through the Conversions API (fbiondiprado,
  // 2026-10-06): a browser-only read showed 0 purchases and hid the option.
  const stub = installMetaFetchStub((request) => request.path === "pixel-1/stats"
    ? { body: { data: [
      { start_time: "2026-10-05T21:00:00+0000", aggregation: "event", data: [{ value: "PageView", count: 40 }, { value: "InitiateCheckout", count: 3 }] },
      { start_time: "2026-10-05T22:00:00+0000", aggregation: "event", data: [{ value: "PageView", count: 12 }, { value: "Purchase", count: 2 }] },
    ] } }
    : undefined);
  try {
    const [source] = await discoverWebsiteSources([{ id: "pixel-1", name: "Loja", last_fired_time: "2026-10-05T22:00:00+0000" }], "token");
    assert.deepEqual(source.observedEvents, ["InitiateCheckout", "PageView", "Purchase"]);
    assert.equal(source.observedEventsStatus, "available");
    const [stats] = stub.calls;
    assert.equal(stats.params.get("aggregation"), "event");
    assert.equal(stats.params.has("event_source"), false);
  } finally {
    stub.restore();
  }
});

test("keeps a Pixel without received events unavailable and a failed read unknown", async () => {
  const stub = installMetaFetchStub((request) => request.path === "quiet/stats"
    ? { body: { data: [] } }
    : { status: 400, body: { error: { message: "Invalid", type: "OAuthException", code: 100 } } });
  try {
    const sources = await discoverWebsiteSources([{ id: "quiet" }, { id: "broken" }], "token");
    assert.deepEqual(sources.map((source) => [source.observedEvents, source.observedEventsStatus]), [[[], "unavailable"], [[], "unknown"]]);
  } finally {
    stub.restore();
  }
});
