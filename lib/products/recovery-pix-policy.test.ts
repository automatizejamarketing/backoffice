import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRecoveryPix,
  isExpiredPixPayment,
  readRecoveryPixStamp,
  recoveryPixExpiresAt,
  resolveRecoveryPixState,
  writeRecoveryPixStamp,
  type RecoveryOrderInput,
} from "./recovery-pix-policy";

const NOW = new Date("2026-09-08T12:00:00.000Z");

/** Pix vencido: o estado em que a MP e o webhook deixam a venda perdida. */
function expiredPixOrder(
  overrides: Partial<RecoveryOrderInput> = {},
): RecoveryOrderInput {
  return {
    orderStatus: "failed",
    paymentStatus: "failed",
    paymentRawStatus: "cancelled",
    paymentMethodId: "pix",
    attribution: null,
    ...overrides,
  };
}

test("Pix vencido é exatamente failed + cancelled + pix", () => {
  assert.equal(isExpiredPixPayment(expiredPixOrder()), true);

  // Cartão recusado também derruba o pedido, mas não se resolve com Pix novo.
  assert.equal(
    isExpiredPixPayment(expiredPixOrder({ paymentMethodId: "master" })),
    false,
  );
  // Ainda dentro da janela de 1h: o cliente ainda pode pagar sozinho.
  assert.equal(
    isExpiredPixPayment(
      expiredPixOrder({
        orderStatus: "pending",
        paymentStatus: "pending",
        paymentRawStatus: "pending",
      }),
    ),
    false,
  );
  // Nem chegou a gerar cobrança.
  assert.equal(
    isExpiredPixPayment(
      expiredPixOrder({ paymentStatus: null, paymentRawStatus: null, paymentMethodId: null }),
    ),
    false,
  );
});

test("pedido com Pix vencido entra na fila de recuperação", () => {
  assert.deepEqual(resolveRecoveryPixState(expiredPixOrder(), NOW), {
    kind: "expired",
  });
  assert.deepEqual(evaluateRecoveryPix(expiredPixOrder(), {
    now: NOW,
    buyerHasOtherOpenOrder: false,
  }), { ok: true, action: "create" });
});

test("pedido já pago não gera Pix", () => {
  const paid = expiredPixOrder({ orderStatus: "approved", paymentStatus: "approved" });
  assert.deepEqual(resolveRecoveryPixState(paid, NOW), { kind: "settled" });
  assert.deepEqual(
    evaluateRecoveryPix(paid, { now: NOW, buyerHasOtherOpenOrder: false }),
    { ok: false, reason: "already_paid" },
  );
});

test("estorno não é caso de recuperação", () => {
  const refunded = expiredPixOrder({ orderStatus: "refunded" });
  assert.deepEqual(
    evaluateRecoveryPix(refunded, { now: NOW, buyerHasOtherOpenOrder: false }),
    { ok: false, reason: "refunded" },
  );
});

test("cartão recusado é recusado com motivo próprio", () => {
  assert.deepEqual(
    evaluateRecoveryPix(expiredPixOrder({ paymentMethodId: "master" }), {
      now: NOW,
      buyerHasOtherOpenOrder: false,
    }),
    { ok: false, reason: "not_expired_pix" },
  );
});

test("outra compra aberta do mesmo produto bloqueia a reabertura", () => {
  // O índice único parcial product_orders_one_open_purchase estouraria no banco;
  // recusar com motivo é melhor do que deixar o INSERT explodir.
  assert.deepEqual(
    evaluateRecoveryPix(expiredPixOrder(), {
      now: NOW,
      buyerHasOtherOpenOrder: true,
    }),
    { ok: false, reason: "buyer_has_open_order" },
  );
});

test("Pix de recuperação ainda válido é reaproveitado, não duplicado", () => {
  const stamped = expiredPixOrder({
    orderStatus: "pending",
    paymentStatus: "pending",
    paymentRawStatus: null,
    attribution: writeRecoveryPixStamp(null, {
      generatedAt: new Date("2026-09-08T10:00:00.000Z"),
      expiresAt: new Date("2026-09-09T10:00:00.000Z"),
      adminEmail: "admin@automatize.com",
      attempts: 1,
    }),
  });

  const state = resolveRecoveryPixState(stamped, NOW);
  assert.equal(state.kind, "active");

  const decision = evaluateRecoveryPix(stamped, {
    now: NOW,
    buyerHasOtherOpenOrder: false,
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.ok && decision.action, "reuse");
});

test("passadas as 24h o pedido volta para a fila", () => {
  const stale = expiredPixOrder({
    attribution: writeRecoveryPixStamp(null, {
      generatedAt: new Date("2026-09-06T10:00:00.000Z"),
      expiresAt: new Date("2026-09-07T10:00:00.000Z"),
      adminEmail: "admin@automatize.com",
      attempts: 2,
    }),
  });

  assert.deepEqual(resolveRecoveryPixState(stale, NOW), { kind: "expired" });
  assert.deepEqual(
    evaluateRecoveryPix(stale, { now: NOW, buyerHasOtherOpenOrder: false }),
    { ok: true, action: "create" },
  );
});

test("carimbo sobrevive à ida e volta sem apagar a atribuição existente", () => {
  const attribution = writeRecoveryPixStamp(
    { utm_source: "instagram", order_bump_order_ids: "a,b" },
    {
      generatedAt: new Date("2026-09-08T11:00:00.000Z"),
      expiresAt: new Date("2026-09-09T11:00:00.000Z"),
      adminEmail: "vendedor@automatize.com",
      attempts: 3,
    },
  );

  assert.equal(attribution.utm_source, "instagram");
  assert.equal(attribution.order_bump_order_ids, "a,b");

  const stamp = readRecoveryPixStamp(attribution);
  assert.equal(stamp?.adminEmail, "vendedor@automatize.com");
  assert.equal(stamp?.attempts, 3);
  assert.equal(stamp?.expiresAt.toISOString(), "2026-09-09T11:00:00.000Z");
});

test("carimbo corrompido não derruba a leitura", () => {
  assert.equal(readRecoveryPixStamp(null), null);
  assert.equal(readRecoveryPixStamp({ recovery_pix_generated_at: "não é data" }), null);
  // Sem `expires_at` não dá para dizer se o código ainda vale — trata como ausente.
  assert.equal(
    readRecoveryPixStamp({ recovery_pix_generated_at: "2026-09-08T10:00:00.000Z" }),
    null,
  );
});

test("o Pix de recuperação vale 24h", () => {
  assert.equal(
    recoveryPixExpiresAt(NOW).toISOString(),
    "2026-09-09T12:00:00.000Z",
  );
});

test("ids de order bump são lidos igual ao app", async () => {
  const { parseOrderBumpOrderIds } = await import("./recovery-pix-policy");
  const a = "0b6c1d3e-4f5a-4b6c-8d9e-0f1a2b3c4d5e";
  const b = "1c7d2e4f-5a6b-4c7d-9e0f-1a2b3c4d5e6f";

  assert.deepEqual(parseOrderBumpOrderIds(`${a},${b}`), [a, b]);
  assert.deepEqual(parseOrderBumpOrderIds(""), []);
  assert.deepEqual(parseOrderBumpOrderIds(null), []);
  assert.deepEqual(parseOrderBumpOrderIds(`${a},${a}`), [a]);
  // Lixo vira lista vazia dos dois lados — se divergisse, eu reabriria um grupo
  // diferente do que a aprovação enxerga.
  assert.deepEqual(parseOrderBumpOrderIds("nao-e-uuid"), []);
  assert.deepEqual(parseOrderBumpOrderIds([a, b, a, b, a, b].join(",")), []);
});
