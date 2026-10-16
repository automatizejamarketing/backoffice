import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { objectiveFamily } from "./objective";

describe("família do objetivo", () => {
  it("separa vendas de tráfego, nos objetivos novos e nos antigos", () => {
    assert.equal(objectiveFamily("OUTCOME_SALES"), "vendas");
    assert.equal(objectiveFamily("CONVERSIONS"), "vendas");
    assert.equal(objectiveFamily("OUTCOME_TRAFFIC"), "trafego");
    assert.equal(objectiveFamily("LINK_CLICKS"), "trafego");
    assert.equal(objectiveFamily("OUTCOME_ENGAGEMENT"), "mensagens");
  });

  it("sem objetivo não mostra selo; desconhecido vira outro", () => {
    assert.equal(objectiveFamily(null), null);
    assert.equal(objectiveFamily("NOVO_OBJETIVO"), "outro");
  });
});
