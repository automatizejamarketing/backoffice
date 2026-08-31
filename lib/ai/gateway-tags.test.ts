import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GATEWAY_TAG, gatewayProviderOptions } from "./gateway-tags";

describe("gatewayProviderOptions", () => {
  it("tags a request with a single Gateway reporting tag", () => {
    assert.deepEqual(gatewayProviderOptions("ai-imagem"), {
      gateway: { tags: [GATEWAY_TAG.aiImagem] },
    });
  });

  it("attaches the end-user id when provided", () => {
    assert.deepEqual(
      gatewayProviderOptions("ai-campanha-copy", { user: "user-99" }),
      {
        gateway: { tags: [GATEWAY_TAG.aiCampanhaCopy], user: "user-99" },
      },
    );
  });
});
