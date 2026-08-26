import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GATEWAY_TAG, gatewayProviderOptions } from "./gateway-tags";

describe("gatewayProviderOptions", () => {
  it("tags a request with a single Gateway reporting tag", () => {
    assert.deepEqual(gatewayProviderOptions("imagem"), {
      gateway: { tags: [GATEWAY_TAG.imagem] },
    });
  });

  it("attaches the end-user id when provided", () => {
    assert.deepEqual(gatewayProviderOptions("campanha", { user: "user-99" }), {
      gateway: { tags: [GATEWAY_TAG.campanha], user: "user-99" },
    });
  });
});
