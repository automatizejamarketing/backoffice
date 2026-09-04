import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXPERT_COPRODUCER_BLOCKED_MESSAGE,
  validateCoproducerSelection,
} from "./coproducer-policy";

describe("coprodutor permitido no cadastro de produto", () => {
  it("aceita nenhum coprodutor", () => {
    assert.deepEqual(
      validateCoproducerSelection({ hasCoproduction: false }),
      { ok: true },
    );
  });

  it("aceita Coprodução do Automatize", () => {
    assert.deepEqual(
      validateCoproducerSelection({
        hasCoproduction: true,
        coproducerType: "automatize",
      }),
      { ok: true },
    );
  });

  it("bloqueia coprodutor Expert com mensagem clara", () => {
    assert.deepEqual(
      validateCoproducerSelection({
        hasCoproduction: true,
        coproducerType: "expert",
      }),
      { ok: false, message: EXPERT_COPRODUCER_BLOCKED_MESSAGE },
    );
  });
});
