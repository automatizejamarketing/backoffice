import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { uploadMedia, type MediaUploadOptions } from "./media-upload-client";

const realFetch = globalThis.fetch;
let calls: { input: string; init?: RequestInit }[] = [];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(response: Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return response;
  }) as typeof fetch;
}

describe("uploadMedia", () => {
  it("exige endpoint: sem ele falha antes de qualquer chamada de rede", async () => {
    stubFetch(new Response("{}", { status: 200 }));
    await assert.rejects(
      uploadMedia("referral-payouts/x/p.png", new Blob(["x"], { type: "image/png" }), {} as MediaUploadOptions),
      /uploadMedia: endpoint é obrigatório/,
    );
    assert.deepEqual(calls, []);
  });
  it("presign vai para o endpoint informado", async () => {
    stubFetch(new Response(JSON.stringify({ error: "Upload failed" }), { status: 400 }));
    await assert.rejects(
      uploadMedia("referral-payouts/x/p.png", new Blob(["x"], { type: "image/png" }), {
        endpoint: "/api/referrals/payouts/proof-upload",
      }),
      /Upload failed/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.input, "/api/referrals/payouts/proof-upload");
  });
});
