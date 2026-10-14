import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOARD_URL,
  TRAFEGO_GC_MS,
  TRAFEGO_ROOT_KEY,
  TRAFEGO_STALE_MS,
  carteiraUrl,
  datasetOfView,
  siblingDataset,
  trafegoKeys,
} from "./trafego-query";

describe("chaves do cache de Tráfego", () => {
  it("carteira por período, quadro fixo, tudo debaixo de ['trafego']", () => {
    assert.deepEqual(trafegoKeys.carteira(7), ["trafego", "carteira", 7]);
    assert.deepEqual(trafegoKeys.carteira(30), ["trafego", "carteira", 30]);
    assert.deepEqual(trafegoKeys.board(), ["trafego", "board"]);
    for (const key of [trafegoKeys.carteira(14), trafegoKeys.board()]) {
      assert.equal(key[0], TRAFEGO_ROOT_KEY[0]);
    }
  });

  it("período fora da lista vira 7 (mesma chave que a página padrão)", () => {
    assert.deepEqual(trafegoKeys.carteira(99), trafegoKeys.carteira(7));
    assert.equal(carteiraUrl(3), "/api/consultant-workspace/carteira?dias=7");
    assert.equal(carteiraUrl(14), "/api/consultant-workspace/carteira?dias=14");
  });

  it("tempos: 2 min fresco, 30 min guardado", () => {
    assert.equal(TRAFEGO_STALE_MS, 120_000);
    assert.equal(TRAFEGO_GC_MS, 1_800_000);
  });
});

describe("o que cada visão lê", () => {
  it("Fila e Mesa leem a carteira do período da URL; Jornada, o quadro", () => {
    assert.deepEqual(datasetOfView("fila", "dias=14&plano=pro"), { kind: "carteira", days: 14 });
    assert.deepEqual(datasetOfView("mesa", ""), { kind: "carteira", days: 7 });
    assert.deepEqual(datasetOfView("jornada", "dias=30"), { kind: "board" });
    assert.equal(BOARD_URL, "/api/consultant-workspace/board");
  });

  it("aquece a irmã: carteira 7d ↔ quadro", () => {
    assert.deepEqual(siblingDataset("board"), { kind: "carteira", days: 7 });
    assert.deepEqual(siblingDataset("carteira"), { kind: "board" });
  });
});
