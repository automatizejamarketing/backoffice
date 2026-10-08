import { describe, expect, test } from "bun:test";
import { buildAccessSummary } from "./access-summary";

// 09/09/2026 12:00 em São Paulo.
const now = new Date("2026-09-09T15:00:00.000Z");

function stripeRow(overrides: Record<string, unknown> = {}) {
  return {
    provider: "stripe" as const,
    status: "active" as const,
    planType: "monthly_starter" as const,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-09-30T15:00:00.000Z"),
    createdAt: new Date("2026-08-30T15:00:00.000Z"),
    ...overrides,
  };
}

function pixLink(overrides: Record<string, unknown> = {}) {
  return {
    status: "approved",
    planType: "monthly_starter" as const,
    amount: 29700,
    createdAt: new Date("2026-08-01T15:00:00.000Z"),
    expiresAt: new Date("2026-08-02T15:00:00.000Z"),
    ...overrides,
  };
}

describe("buildAccessSummary", () => {
  test("Stripe ativo: acesso pela data de expiração e cobrança pelo Stripe", () => {
    const summary = buildAccessSummary({
      expirationDate: "2026-09-30T15:00:00.000Z",
      subscriptions: [stripeRow()],
      pixLinks: [],
      now,
    });

    expect(summary.access).toEqual({
      tone: "success",
      label: "Ativo até 30/09/2026",
      hint: "em 21 dias",
    });
    expect(summary.billing.title).toBe("Stripe/cartão · Starter Mensal");
    expect(summary.billing.badge).toEqual({
      tone: "success",
      label: "Ativa",
      hint: "próxima cobrança 30/09/2026",
    });
    expect(summary.notice).toBeNull();
  });

  test("Stripe com cancelamento agendado mostra quando cancela", () => {
    const summary = buildAccessSummary({
      expirationDate: "2026-09-30T15:00:00.000Z",
      subscriptions: [stripeRow({ cancelAtPeriodEnd: true })],
      pixLinks: [],
      now,
    });

    expect(summary.billing.badge).toEqual({
      tone: "warning",
      label: "Ativa",
      hint: "cancela em 30/09/2026",
    });
  });

  test("usa a assinatura mais relevante, não a mais recente", () => {
    const summary = buildAccessSummary({
      expirationDate: "2026-09-30T15:00:00.000Z",
      subscriptions: [
        stripeRow({
          status: "canceled",
          createdAt: new Date("2026-09-05T15:00:00.000Z"),
        }),
        stripeRow({ status: "past_due" }),
      ],
      pixLinks: [],
      now,
    });

    expect(summary.billing.badge?.label).toBe("Pagamento atrasado");
  });

  test("Pix vencido sem pagamento: acesso vencido, último Pix e aviso de renovação", () => {
    const summary = buildAccessSummary({
      expirationDate: "2026-09-05T15:00:00.000Z",
      subscriptions: [
        {
          provider: "mercadopago" as const,
          status: "active" as const,
          planType: "monthly_starter" as const,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date("2026-09-05T15:00:00.000Z"),
          createdAt: new Date("2026-08-05T15:00:00.000Z"),
        },
      ],
      pixLinks: [
        pixLink(),
        pixLink({
          status: "pending",
          createdAt: new Date("2026-09-06T15:00:00.000Z"),
          expiresAt: new Date("2026-09-07T15:00:00.000Z"),
        }),
      ],
      now,
    });

    expect(summary.access).toEqual({
      tone: "destructive",
      label: "Vencido em 05/09/2026",
      hint: "há 4 dias",
    });
    expect(summary.billing.title).toBe("Mercado Pago Pix · pré-pago · Starter Mensal");
    expect(summary.billing.badge).toEqual({
      tone: "destructive",
      label: "Pix: expirou sem pagamento",
      // Intl separa o "R$" com espaço não separável.
      hint: "R$ 297,00 · gerado 06/09/2026",
    });
    expect(summary.notice?.title).toBe("Renovação pendente");
  });

  test("Stripe cobrando com acesso vencido avisa a divergência", () => {
    const summary = buildAccessSummary({
      expirationDate: "2026-09-05T15:00:00.000Z",
      subscriptions: [stripeRow()],
      pixLinks: [],
      now,
    });

    expect(summary.notice?.title).toBe("Cobrança e acesso divergentes");
  });

  test("sem data, sem assinatura e sem Pix", () => {
    const summary = buildAccessSummary({
      expirationDate: null,
      subscriptions: [],
      pixLinks: [],
      now,
    });

    expect(summary.access).toEqual({
      tone: "neutral",
      label: "Sem data de acesso",
    });
    expect(summary.billing).toEqual({
      title: "Sem cobrança registrada",
      badge: null,
      empty: "Nenhum Pix gerado para este cliente.",
    });
    expect(summary.notice).toBeNull();
  });

  test("o resumo vai como JSON sem perder nada", () => {
    const summary = buildAccessSummary({
      expirationDate: "2026-09-05T15:00:00.000Z",
      subscriptions: [stripeRow()],
      pixLinks: [pixLink()],
      now,
    });

    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});
