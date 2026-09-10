import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmAudienceMetadataUpdate,
  reconcileAudienceMetadataUpdate,
  previewAudienceMetadataUpdate,
} from "../lib/meta-business/marketing/audiences/update";

type StubCall = {
  method: string;
  path: string;
  params: URLSearchParams;
  body: BodyInit | null | undefined;
};

function installMetaFetchStub(
  handler: (call: StubCall) => { body: unknown; status?: number },
) {
  const originalFetch = globalThis.fetch;
  const calls: StubCall[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const marker = "/v25.0/";
    const markerIndex = url.pathname.indexOf(marker);
    const call = {
      method: init?.method ?? "GET",
      path: markerIndex >= 0 ? url.pathname.slice(markerIndex + marker.length) : url.pathname,
      params: init?.body instanceof URLSearchParams ? init.body : url.searchParams,
      body: init?.body,
    };
    calls.push(call);
    const result = handler(call);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("backoffice metadata review reports known uses and incomplete coverage", async () => {
  const stub = installMetaFetchStub((request) => {
    if (request.path === "CA1") {
      return {
        body: {
          id: "CA1",
          account_id: "act_1",
          name: "Visitantes antigos",
          description: "Antes",
          rule: { opaque: true },
          lookalike_audience_ids: ["LL1"],
          permission_for_actions: { can_edit: true },
        },
      };
    }
    if (request.path === "act_1/adsets") {
      return {
        body: {
          data: [{
            id: "AS1",
            name: "Conjunto principal",
            campaign: { id: "C1", name: "Campanha" },
            targeting: { custom_audiences: [{ id: "CA1" }] },
          }],
          paging: { next: "https://graph.facebook.com/next" },
        },
      };
    }
    throw new Error(`Unexpected request: ${request.method} ${request.path}`);
  });

  try {
    const review = await previewAudienceMetadataUpdate({
      audienceId: "CA1",
      adAccountId: "1",
      accessToken: "token",
      name: "Visitantes recentes",
    });
    assert.equal(review.ok, true);
    if (!review.ok) return;
    assert.deepEqual(review.before, { name: "Visitantes antigos", description: "Antes" });
    assert.deepEqual(review.after, { name: "Visitantes recentes", description: "Antes" });
    assert.deepEqual(review.impact.knownUses, [{
      campaignId: "C1",
      campaignName: "Campanha",
      adSetId: "AS1",
      adSetName: "Conjunto principal",
      placement: "include",
    }]);
    assert.deepEqual(review.impact.dependentAudienceIds, ["LL1"]);
    assert.equal(review.impact.coverage, "incomplete");
    assert.equal(stub.calls.some((call) => call.method === "POST"), false);
  } finally {
    stub.restore();
  }
});

test("backoffice confirmation rejects a stale review and writes metadata sparsely", async () => {
  const stub = installMetaFetchStub((request) => {
      if (request.path === "CA1" && request.method === "GET") {
        return { body: { id: "CA1", account_id: "act_1", name: "Antes", rule: { opaque: true }, permission_for_actions: { can_edit: true } } };
    }
    if (request.path === "act_1/adsets") return { body: { data: [] } };
    if (request.path === "CA1" && request.method === "POST") return { body: { success: true } };
    throw new Error(`Unexpected request: ${request.method} ${request.path}`);
  });

  try {
    const review = await previewAudienceMetadataUpdate({
      audienceId: "CA1",
      adAccountId: "1",
      accessToken: "token",
      name: "Depois",
    });
    assert.equal(review.ok, true);
    if (!review.ok) return;
    const stale = await confirmAudienceMetadataUpdate({
      audienceId: "CA1",
      adAccountId: "1",
      accessToken: "token",
      name: "Outro",
      confirmationToken: review.confirmationToken,
    });
    assert.equal(stale.ok, false);
    assert.equal(stub.calls.some((call) => call.method === "POST"), false);
    const saved = await confirmAudienceMetadataUpdate({
      audienceId: "CA1",
      adAccountId: "1",
      accessToken: "token",
      name: "Depois",
      confirmationToken: review.confirmationToken,
    });
    assert.equal(saved.ok, true);
    const write = stub.calls.find((call) => call.method === "POST");
    assert.equal(write?.params.get("name"), "Depois");
    assert.equal(write?.params.has("rule"), false);
  } finally {
    stub.restore();
  }
});

test("backoffice metadata confirmation acknowledges a completed retry without posting twice", async () => {
  const snapshot = { id: "CA2", account_id: "act_2", name: "Antes", description: "Descrição", rule: { opaque: true }, permission_for_actions: { can_edit: true } };
  const stub = installMetaFetchStub((request) => {
      if (request.path === "CA2" && request.method === "GET") return { body: snapshot };
    if (request.path === "act_2/adsets") return { body: { data: [] } };
    if (request.path === "CA2" && request.method === "POST") {
      snapshot.name = request.params.get("name") ?? snapshot.name;
      snapshot.description = request.params.get("description") ?? snapshot.description;
      return { body: { success: true } };
    }
    throw new Error(`Unexpected request: ${request.method} ${request.path}`);
  });
  try {
    const review = await previewAudienceMetadataUpdate({ audienceId: "CA2", adAccountId: "2", accessToken: "token", name: "Depois" });
    assert.equal(review.ok, true);
    if (!review.ok) return;
    const saved = await confirmAudienceMetadataUpdate({ audienceId: "CA2", adAccountId: "2", accessToken: "token", name: "Depois", confirmationToken: review.confirmationToken });
    assert.equal(saved.ok, true);
    const retried = await confirmAudienceMetadataUpdate({ audienceId: "CA2", adAccountId: "2", accessToken: "token", name: "Depois", confirmationToken: review.confirmationToken });
    assert.equal(retried.ok, true);
    if (!retried.ok) return;
    assert.equal(retried.data.alreadyApplied, true);
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, 1);
  } finally { stub.restore(); }
});

test("backoffice metadata mutation exposes reconciliation and never blindly retries an uncertain command", async () => {
  const snapshot = { id: "CA3", account_id: "act_3", name: "Antes", description: "Descrição", rule: { opaque: true }, permission_for_actions: { can_edit: true } };
  let uncertain = true;
  const stub = installMetaFetchStub((request) => {
    if (request.path === "CA3" && request.method === "GET") return { body: snapshot };
    if (request.path === "act_3/adsets") return { body: { data: [] } };
    if (request.path === "CA3" && request.method === "POST" && uncertain) {
      uncertain = false;
      throw new Error("connection closed after request");
    }
    throw new Error(`Unexpected request: ${request.method} ${request.path}`);
  });
  try {
    const review = await previewAudienceMetadataUpdate({ audienceId: "CA3", adAccountId: "3", accessToken: "token", name: "Depois" });
    assert.equal(review.ok, true);
    if (!review.ok) return;
    const first = await confirmAudienceMetadataUpdate({ audienceId: "CA3", adAccountId: "3", accessToken: "token", name: "Depois", confirmationToken: review.confirmationToken, commandId: review.commandId });
    assert.equal(first.ok, false);
    if (first.ok) return;
    assert.equal(first.issues[0]?.code, "META_MUTATION_UNCERTAIN");
    const postCount = stub.calls.filter((call) => call.method === "POST").length;
    const repeated = await confirmAudienceMetadataUpdate({ audienceId: "CA3", adAccountId: "3", accessToken: "token", name: "Depois", confirmationToken: review.confirmationToken, commandId: review.commandId });
    assert.equal(repeated.ok, false);
    assert.equal(repeated.ok ? undefined : repeated.issues[0]?.code, "META_MUTATION_UNCERTAIN");
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, postCount);
    snapshot.name = "Depois";
    const reconciled = await reconcileAudienceMetadataUpdate({ audienceId: "CA3", adAccountId: "3", accessToken: "token", name: "Depois", confirmationToken: review.confirmationToken, commandId: review.commandId });
    assert.equal(reconciled.ok, true);
  } finally { stub.restore(); }
});

test("backoffice metadata review refuses an externally shared audience without edit capability", async () => {
  const stub = installMetaFetchStub((request) => {
    if (request.path === "CA4") return { body: { id: "CA4", account_id: "act_4", name: "Externo", permission_for_actions: { can_edit: false } } };
    throw new Error(`Unexpected request: ${request.path}`);
  });
  try {
    const review = await previewAudienceMetadataUpdate({ audienceId: "CA4", adAccountId: "4", accessToken: "token", name: "Novo" });
    assert.equal(review.ok, false);
    if (review.ok) return;
    assert.equal(review.issues[0]?.code, "META_CAPABILITY_UNAVAILABLE");
    assert.equal(stub.calls.some((call) => call.method === "POST"), false);
  } finally { stub.restore(); }
});
