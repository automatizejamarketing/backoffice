import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  classifyReferralCustomerAccount,
  describeReferralCustomerAccount,
  summarizeReferralAffiliateCustomers,
  summarizeReferralCustomerCommissions,
  type ReferralCustomerAccountInput,
} from "./customers";

// O que estes testes protegem: o selo que diz ao operador se o indicado virou
// cliente pagante. Os filtros da tela de Usuários se sobrepõem (quem paga por
// Pix também é "Plano ativo"); aqui cada indicado precisa de UM rótulo, e a
// ordem de precedência é a decisão que um `if` trocado de lugar desfaria sem
// ninguém notar.

const NOW = new Date("2026-10-10T15:00:00.000Z");
const IN_FIVE_DAYS = new Date("2026-10-15T15:00:00.000Z");
const NINE_DAYS_AGO = new Date("2026-10-01T15:00:00.000Z");

function account(
  overrides: Partial<ReferralCustomerAccountInput> = {},
): ReferralCustomerAccountInput {
  return {
    expirationDate: null,
    hasApprovedPayment: false,
    hasSubscription: false,
    scheduledCancel: false,
    lastPaymentProvider: null,
    ...overrides,
  };
}

describe("classifyReferralCustomerAccount", () => {
  const cases: Array<{
    name: string;
    input: ReferralCustomerAccountInput;
    want: ReturnType<typeof classifyReferralCustomerAccount>;
  }> = [
    {
      name: "pagou no cartão, acesso vigente, sem cancelamento",
      input: account({
        hasApprovedPayment: true,
        hasSubscription: true,
        expirationDate: IN_FIVE_DAYS,
        lastPaymentProvider: "stripe",
      }),
      want: "active_plan",
    },
    {
      name: "pagou no cartão e pediu cancelamento, acesso ainda vigente",
      input: account({
        hasApprovedPayment: true,
        hasSubscription: true,
        expirationDate: IN_FIVE_DAYS,
        scheduledCancel: true,
        lastPaymentProvider: "stripe",
      }),
      want: "active_plan_canceled",
    },
    {
      name: "último pagamento por Pix, acesso vigente",
      input: account({
        hasApprovedPayment: true,
        expirationDate: IN_FIVE_DAYS,
        lastPaymentProvider: "mercadopago",
      }),
      want: "active_plan_pix",
    },
    {
      // A assinatura Stripe cancelada não conta quando o último pagamento foi
      // Pix — mesma regra de `countsAsScheduledCancel`.
      name: "Pix com assinatura Stripe cancelada continua plano com pix",
      input: account({
        hasApprovedPayment: true,
        hasSubscription: true,
        expirationDate: IN_FIVE_DAYS,
        scheduledCancel: true,
        lastPaymentProvider: "mercadopago",
      }),
      want: "active_plan_pix",
    },
    {
      name: "pagou e o acesso venceu",
      input: account({
        hasApprovedPayment: true,
        hasSubscription: true,
        expirationDate: NINE_DAYS_AGO,
        lastPaymentProvider: "stripe",
      }),
      want: "subscribed_expired",
    },
    {
      name: "pagou e o acesso vence exatamente agora",
      input: account({
        hasApprovedPayment: true,
        expirationDate: NOW,
        lastPaymentProvider: "stripe",
      }),
      want: "subscribed_expired",
    },
    {
      name: "pagou mas não tem data de acesso",
      input: account({
        hasApprovedPayment: true,
        lastPaymentProvider: "manual",
      }),
      want: "paid_no_access_date",
    },
    {
      // Trial em andamento: o acesso vigente não faz dele pagante.
      name: "tem assinatura e acesso vigente, nunca pagou",
      input: account({
        hasSubscription: true,
        expirationDate: IN_FIVE_DAYS,
      }),
      want: "trial_no_payment",
    },
    {
      name: "tem assinatura vencida, nunca pagou",
      input: account({
        hasSubscription: true,
        expirationDate: NINE_DAYS_AGO,
      }),
      want: "trial_no_payment",
    },
    {
      name: "sem assinatura e sem pagamento",
      input: account(),
      want: "no_card_no_payment",
    },
  ];

  for (const { name, input, want } of cases) {
    test(name, () => {
      assert.equal(classifyReferralCustomerAccount(input, NOW), want);
    });
  }
});

describe("describeReferralCustomerAccount", () => {
  test("plano ativo vira selo de sucesso com a data de acesso no detalhe", () => {
    assert.deepEqual(
      describeReferralCustomerAccount(
        account({
          hasApprovedPayment: true,
          expirationDate: IN_FIVE_DAYS,
          lastPaymentProvider: "stripe",
        }),
        NOW,
      ),
      {
        status: "active_plan",
        tone: "success",
        label: "Plano ativo",
        hint: "Ativo até 15/10/2026 · em 5 dias",
      },
    );
  });

  test("cancelamento agendado é aviso, não sucesso", () => {
    assert.deepEqual(
      describeReferralCustomerAccount(
        account({
          hasApprovedPayment: true,
          expirationDate: IN_FIVE_DAYS,
          scheduledCancel: true,
          lastPaymentProvider: "stripe",
        }),
        NOW,
      ),
      {
        status: "active_plan_canceled",
        tone: "warning",
        label: "Plano ativo mas cancelado",
        hint: "Ativo até 15/10/2026 · em 5 dias",
      },
    );
  });

  test("quem assinou e expirou vira selo destrutivo com a data de vencimento", () => {
    assert.deepEqual(
      describeReferralCustomerAccount(
        account({
          hasApprovedPayment: true,
          expirationDate: NINE_DAYS_AGO,
          lastPaymentProvider: "stripe",
        }),
        NOW,
      ),
      {
        status: "subscribed_expired",
        tone: "destructive",
        label: "Assinou e expirou",
        hint: "Vencido em 01/10/2026 · há 9 dias",
      },
    );
  });

  test("quem nunca pagou fica neutro e diz que não tem data de acesso", () => {
    assert.deepEqual(describeReferralCustomerAccount(account(), NOW), {
      status: "no_card_no_payment",
      tone: "neutral",
      label: "Não botou cartão nem pagou",
      hint: "Sem data de acesso",
    });
  });

  test("pagamento sem data de acesso tem rótulo próprio", () => {
    assert.deepEqual(
      describeReferralCustomerAccount(
        account({ hasApprovedPayment: true, lastPaymentProvider: "manual" }),
        NOW,
      ),
      {
        status: "paid_no_access_date",
        tone: "neutral",
        label: "Pagou, sem data de acesso",
        hint: "Sem data de acesso",
      },
    );
  });
});

describe("summarizeReferralCustomerCommissions", () => {
  test("o total vivo soma prevista, aprovada e paga — e só elas", () => {
    const summary = summarizeReferralCustomerCommissions([
      { status: "foreseen", count: 1, amountCentavos: 1990 },
      { status: "approved", count: 2, amountCentavos: 3980 },
      { status: "paid", count: 1, amountCentavos: 1990 },
      { status: "reversed", count: 1, amountCentavos: 1990 },
      { status: "rejected", count: 1, amountCentavos: 500 },
    ]);

    assert.equal(summary.liveCentavos, 7960);
    assert.deepEqual(summary.byStatus, {
      foreseen: 1990,
      approved: 3980,
      paid: 1990,
      reversed: 1990,
      rejected: 500,
    });
  });

  test("indicado sem comissão tem os cinco estados zerados", () => {
    assert.deepEqual(summarizeReferralCustomerCommissions([]), {
      liveCentavos: 0,
      byStatus: {
        foreseen: 0,
        approved: 0,
        paid: 0,
        reversed: 0,
        rejected: 0,
      },
    });
  });
});

describe("summarizeReferralAffiliateCustomers", () => {
  test("pagante é quem tem plano ativo, com ou sem cancelamento ou Pix", () => {
    assert.deepEqual(
      summarizeReferralAffiliateCustomers([
        { status: "active_plan", liveCommissionCentavos: 1990 },
        { status: "active_plan_canceled", liveCommissionCentavos: 1990 },
        { status: "active_plan_pix", liveCommissionCentavos: 1990 },
        { status: "subscribed_expired", liveCommissionCentavos: 3980 },
        { status: "trial_no_payment", liveCommissionCentavos: 0 },
        { status: "no_card_no_payment", liveCommissionCentavos: 0 },
        { status: "paid_no_access_date", liveCommissionCentavos: 0 },
      ]),
      { total: 7, paying: 3, liveCommissionCentavos: 9950 },
    );
  });

  test("afiliado sem indicados resume tudo zerado", () => {
    assert.deepEqual(summarizeReferralAffiliateCustomers([]), {
      total: 0,
      paying: 0,
      liveCommissionCentavos: 0,
    });
  });
});
