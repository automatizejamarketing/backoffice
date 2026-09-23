import { afterEach, describe, expect, test } from "bun:test";

import {
  ensureMetaTestEnv,
  installMetaFetchStub,
  type MetaFetchStub,
} from "@/tests/helpers/meta-fetch-stub";
import { getAdAccountPixelsWithName } from "./get-ad-account-pixels";

ensureMetaTestEnv();
let stub: MetaFetchStub | undefined;
afterEach(() => {
  stub?.restore();
  stub = undefined;
});

describe("getAdAccountPixelsWithName", () => {
  test("uma chamada só traz o nome da conta e os pixels", async () => {
    stub = installMetaFetchStub(() => ({
      body: { id: "act_123", name: "Loja do Zé", adspixels: { data: [{ id: "PX1", name: "Pixel A" }] } },
    }));
    const result = await getAdAccountPixelsWithName("act_123", "tok");
    expect(result).toEqual({ accountName: "Loja do Zé", data: [{ id: "PX1", name: "Pixel A" }] });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].path).toBe("act_123");
    expect(stub.calls[0].params.get("fields")).toContain("name,adspixels.limit(100){id,name");
  });

  test("conta sem pixel: a Meta omite adspixels e a lista vem vazia", async () => {
    stub = installMetaFetchStub(() => ({ body: { id: "act_123", name: "Loja" } }));
    const result = await getAdAccountPixelsWithName("act_123", "tok");
    expect(result).toEqual({ accountName: "Loja", data: [] });
  });
});
