import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agencyInvoice,
  coverageUntil,
  paidPeriodEnd,
  parsePlanInput,
  planCovers,
  planStatusFromStripe,
  seatRefusal,
  snapshotFromSubscription,
} from "./plan-core";

const at = (iso: string) => new Date(iso);

describe("plano da agência: regras puras", () => {
  it("cobre até o fim do período pago mais 3 dias de carência", () => {
    const paid = at("2026-11-14T00:00:00Z");
    assert.equal(coverageUntil(paid)?.toISOString(), "2026-11-17T00:00:00.000Z");
    assert.equal(planCovers(paid, at("2026-11-16T23:59:00Z")), true);
    assert.equal(planCovers(paid, at("2026-11-17T00:00:01Z")), false);
    assert.equal(planCovers(null), false);
  });

  it("limite de clientes: sem plano recusa; cheio recusa; com vaga passa", () => {
    assert.match(seatRefusal(0, 0)!, /não tem plano/);
    assert.match(seatRefusal(4, 4)!, /cobre 4 clientes/);
    assert.match(seatRefusal(1, 1)!, /cobre 1 cliente /);
    assert.equal(seatRefusal(4, 3), null);
  });

  it("lê o preço em reais do jeito que se digita", () => {
    assert.deepEqual(parsePlanInput({ unitAmount: "249,90", clientLimit: "4" }), { unitAmountCents: 24990, clientLimit: 4 });
    assert.deepEqual(parsePlanInput({ unitAmount: "R$ 1.249,90", clientLimit: 4 }), { unitAmountCents: 124990, clientLimit: 4 });
    assert.deepEqual(parsePlanInput({ unitAmount: "150", clientLimit: 1 }), { unitAmountCents: 15000, clientLimit: 1 });
    assert.ok("error" in parsePlanInput({ unitAmount: "0,50", clientLimit: 4 }));
    assert.ok("error" in parsePlanInput({ unitAmount: "abc", clientLimit: 4 }));
    assert.ok("error" in parsePlanInput({ unitAmount: "100", clientLimit: 0 }));
    assert.ok("error" in parsePlanInput({ unitAmount: "100", clientLimit: "2.5" }));
  });

  it("status do Stripe vira status do plano", () => {
    assert.equal(planStatusFromStripe("trialing"), "active");
    assert.equal(planStatusFromStripe("unpaid"), "past_due");
    assert.equal(planStatusFromStripe("incomplete"), "pending");
    assert.equal(planStatusFromStripe("incomplete_expired"), "canceled");
  });

  it("só assinatura com agency_id vira plano; quantidade é o limite", () => {
    const subscription = {
      id: "sub_1",
      status: "active",
      customer: { id: "cus_1" },
      metadata: { agency_id: "ag-1" },
      items: { data: [{ id: "si_1", quantity: 4, price: { unit_amount: 24990, product: "prod_1" } }] },
    } as unknown as Parameters<typeof snapshotFromSubscription>[0];
    assert.deepEqual(snapshotFromSubscription(subscription), {
      agencyId: "ag-1",
      subscriptionId: "sub_1",
      customerId: "cus_1",
      status: "active",
      clientLimit: 4,
      unitAmountCents: 24990,
      itemId: "si_1",
      productId: "prod_1",
    });
    assert.equal(snapshotFromSubscription({ ...subscription, metadata: { app_user_id: "u" } }), null);
  });

  it("fatura: agência pelos metadados copiados; período pago = maior fim entre as linhas", () => {
    const invoice = {
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { agency_id: "ag-1" } } },
      lines: { data: [{ period: { end: 1_800_000_000 } }, { period: { end: 1_802_000_000 } }] },
    } as unknown as Parameters<typeof agencyInvoice>[0];
    assert.deepEqual(agencyInvoice(invoice), { agencyId: "ag-1", subscriptionId: "sub_1" });
    assert.equal(paidPeriodEnd(invoice)?.getTime(), 1_802_000_000_000);
    const userInvoice = { ...invoice, parent: { type: "subscription_details", subscription_details: { subscription: "sub_2", metadata: { app_user_id: "u" } } } } as typeof invoice;
    assert.equal(agencyInvoice(userInvoice), null);
    assert.equal(paidPeriodEnd({ ...invoice, lines: { data: [] } }), null);
  });
});
