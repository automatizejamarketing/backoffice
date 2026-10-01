import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  DEFAULT_PLACEMENT_ADAPTATION,
  buildDegreesOfFreedomSpec,
} from "@/lib/meta-business/creative-features";
import {
  ensureMetaTestEnv,
  graphErrorBody,
  installMetaFetchStub,
  type MetaFetchStub,
} from "@/tests/helpers/meta-fetch-stub";
import { postAdCreativeForm } from "./ad-creative-post";

ensureMetaTestEnv();

const EXPANSION = JSON.stringify(buildDegreesOfFreedomSpec(DEFAULT_PLACEMENT_ADAPTATION));
const INELIGIBLE = graphErrorBody({ message: "Invalid parameter", code: 100, errorSubcode: 3858023 });
const FIELDS = {
  name: "Criativo",
  object_story_spec: JSON.stringify({ page_id: "p1", link_data: { image_hash: "H" } }),
  contextual_multi_ads: JSON.stringify({ enroll_status: "OPT_OUT" }),
};

let stub: MetaFetchStub | undefined;

afterEach(() => {
  stub?.restore();
  stub = undefined;
});

/** O `fail` dos chamadores reais lança o próprio tipo de erro; aqui, o corpo cru. */
const failWithBody = (data: unknown): never => {
  throw data;
};

describe("postAdCreativeForm", () => {
  it("envia os campos, o token e a expansão num POST /adcreatives", async () => {
    stub = installMetaFetchStub(() => ({ body: { id: "CR1" } }));

    const result = await postAdCreativeForm<{ id: string }>({
      adAccountId: "act_1",
      accessToken: "tok",
      fields: FIELDS,
      fail: failWithBody,
    });

    assert.deepEqual(result, { id: "CR1" });
    assert.equal(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.path, "act_1/adcreatives");
    assert.equal(call.params.get("degrees_of_freedom_spec"), EXPANSION);
    assert.equal(call.params.get("access_token"), "tok");
    for (const [key, value] of Object.entries(FIELDS)) assert.equal(call.params.get(key), value);
  });

  it("no 3858023 repete SÓ o POST /adcreatives, sem o campo — nenhuma mídia é reenviada", async () => {
    stub = installMetaFetchStub((req) =>
      req.params.get("degrees_of_freedom_spec") ? { status: 400, body: INELIGIBLE } : { body: { id: "CR2" } },
    );

    const result = await postAdCreativeForm<{ id: string }>({
      adAccountId: "act_1",
      accessToken: "tok",
      fields: FIELDS,
      fail: failWithBody,
    });

    assert.deepEqual(result, { id: "CR2" });
    assert.equal(stub.calls.length, 2);
    assert.ok(stub.calls.every((c) => c.path === "act_1/adcreatives"));
    assert.equal(stub.calls[1].params.get("degrees_of_freedom_spec"), null);
    assert.equal(stub.calls[1].params.get("object_story_spec"), FIELDS.object_story_spec);
  });

  it("outro erro chama `fail` uma vez, com corpo e status, e não tenta de novo", async () => {
    const other = graphErrorBody({ message: "Invalid parameter", code: 100, errorSubcode: 1487390 });
    stub = installMetaFetchStub(() => ({ status: 400, body: other }));
    const seen: Array<{ data: unknown; status: number }> = [];

    await assert.rejects(
      postAdCreativeForm({
        adAccountId: "act_1",
        accessToken: "tok",
        fields: FIELDS,
        fail: (data, status) => {
          seen.push({ data, status });
          throw new Error("falhou");
        },
      }),
      /falhou/,
    );

    assert.equal(stub.calls.length, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].status, 400);
    assert.deepEqual(seen[0].data, other);
  });

  it("se a segunda tentativa também falhar, o erro dela sobe — sem terceira", async () => {
    stub = installMetaFetchStub(() => ({ status: 400, body: INELIGIBLE }));

    await assert.rejects(
      postAdCreativeForm({ adAccountId: "act_1", accessToken: "tok", fields: FIELDS, fail: failWithBody }),
    );
    assert.equal(stub.calls.length, 2);
  });
});
