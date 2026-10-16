import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessSegmentOf, EXPIRED_WINDOW_DAYS, isCoreSegment, PAST_DUE_GRACE_DAYS } from "./access";

const now = new Date("2026-10-16T12:00:00Z").getTime();
const day = 86_400_000;
const inDays = (days: number) => new Date(now + days * day).toISOString();

describe("grupo de acesso", () => {
  it("assinatura ativa com acesso válido é pagante", () => {
    assert.equal(accessSegmentOf({ status: "active", accessUntil: inDays(20) }, now), "pagante");
  });

  it("status ativo com acesso vencido é expirado (Mercado Pago sem atualizar), até a janela do CRM", () => {
    assert.equal(accessSegmentOf({ status: "active", accessUntil: inDays(-3) }, now), "expirado");
    assert.equal(accessSegmentOf({ status: "active", accessUntil: inDays(-EXPIRED_WINDOW_DAYS - 1) }, now), null);
    assert.equal(accessSegmentOf({ status: "active", accessUntil: null }, now), null);
  });

  it("trial, cancelado e sem assinatura só contam com acesso válido", () => {
    assert.equal(accessSegmentOf({ status: "trialing", accessUntil: inDays(5) }, now), "trial");
    assert.equal(accessSegmentOf({ status: "trialing", accessUntil: inDays(-1) }, now), "expirado");
    assert.equal(accessSegmentOf({ status: "canceled", accessUntil: inDays(10) }, now), "cancelado");
    assert.equal(accessSegmentOf({ status: "canceled", accessUntil: inDays(-1) }, now), "expirado");
    assert.equal(accessSegmentOf({ status: null, accessUntil: inDays(60) }, now), "manual");
    assert.equal(accessSegmentOf({ status: "incomplete_expired", accessUntil: inDays(60) }, now), "manual");
  });

  it("past_due aparece como inadimplente só até o fim da tolerância", () => {
    assert.equal(accessSegmentOf({ status: "past_due", accessUntil: inDays(3) }, now), "inadimplente");
    assert.equal(accessSegmentOf({ status: "past_due", accessUntil: inDays(-2) }, now), "inadimplente");
    assert.equal(accessSegmentOf({ status: "past_due", accessUntil: inDays(-PAST_DUE_GRACE_DAYS + 1) }, now), "inadimplente");
    assert.equal(accessSegmentOf({ status: "past_due", accessUntil: inDays(-PAST_DUE_GRACE_DAYS - 1) }, now), "expirado");
    assert.equal(accessSegmentOf({ status: "past_due", accessUntil: inDays(-EXPIRED_WINDOW_DAYS - 1) }, now), null);
    assert.equal(accessSegmentOf({ status: "past_due", accessUntil: null }, now), null);
  });

  it("só os pagantes formam o universo principal", () => {
    assert.equal(isCoreSegment("pagante"), true);
    for (const other of ["trial", "cancelado", "inadimplente", "manual", "expirado"] as const) assert.equal(isCoreSegment(other), false);
  });
});
