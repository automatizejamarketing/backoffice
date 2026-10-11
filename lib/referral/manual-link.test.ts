import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  describeManualLinkCharges,
  describeManualLinkQuota,
  indexManualLinks,
  isReferralCustomerUserUniqueViolation,
  manualLinkActorAllowed,
  parseManualLinkReason,
  planManualReferralLink,
  type ManualLinkState,
} from "./manual-link";

// O que estes testes protegem: o vínculo manual move dinheiro — o motor de
// comissão passa a pagar as cobranças do cliente vinculado. Cada recusa abaixo
// é um caminho em que um `if` trocado de lugar pagaria o afiliado errado, ou
// pagaria por uma conta que é dele mesmo.

const NOW = new Date("2026-10-11T15:00:00.000Z");
const AFFILIATE_ID = "aff-1";

function state(overrides: Partial<ManualLinkState> = {}): ManualLinkState {
  return {
    affiliate: { id: AFFILIATE_ID, status: "approved", userId: "affiliate-user" },
    agreement: { id: "agreement-1" },
    user: { id: "user-1", createdAt: new Date("2026-09-05T12:00:00.000Z") },
    existingCustomer: null,
    ...overrides,
  };
}

describe("planManualReferralLink", () => {
  test("vincula ao acordo vigente, datado pelo cadastro da conta", () => {
    assert.deepEqual(planManualReferralLink(state(), NOW), {
      ok: true,
      agreementId: "agreement-1",
      signedUpAt: new Date("2026-09-05T12:00:00.000Z"),
    });
  });

  test("conta antiga sem created_at fica datada pelo instante do vínculo", () => {
    assert.deepEqual(
      planManualReferralLink(state({ user: { id: "user-1", createdAt: null } }), NOW),
      { ok: true, agreementId: "agreement-1", signedUpAt: NOW },
    );
  });

  const refusals: Array<{ name: string; input: ManualLinkState; status: 404 | 409; message: string }> = [
    {
      name: "usuário inexistente",
      input: state({ user: null }),
      status: 404,
      message: "Usuário não encontrado",
    },
    {
      name: "afiliado pendente",
      input: state({ affiliate: { id: AFFILIATE_ID, status: "pending", userId: "affiliate-user" } }),
      status: 409,
      message: "Só afiliado aprovado pode receber indicado",
    },
    {
      name: "afiliado bloqueado",
      input: state({ affiliate: { id: AFFILIATE_ID, status: "blocked", userId: "affiliate-user" } }),
      status: 409,
      message: "Só afiliado aprovado pode receber indicado",
    },
    {
      name: "afiliado sem acordo vigente",
      input: state({ agreement: null }),
      status: 409,
      message: "Afiliado sem acordo vigente",
    },
    {
      name: "a conta do próprio afiliado",
      input: state({ user: { id: "affiliate-user", createdAt: NOW } }),
      status: 409,
      message: "Esta é a conta do próprio afiliado",
    },
    {
      name: "já indicado deste afiliado",
      input: state({
        existingCustomer: {
          affiliateId: AFFILIATE_ID,
          affiliateLabel: "U7 Expert",
          signedUpAt: new Date("2026-08-19T17:18:11.234Z"),
        },
      }),
      status: 409,
      message: "Já é indicado deste afiliado desde 19/08/2026",
    },
    {
      name: "já indicado de outro afiliado",
      input: state({
        existingCustomer: {
          affiliateId: "aff-2",
          affiliateLabel: "Queens Burgers",
          signedUpAt: new Date("2026-09-30T13:00:00.000Z"),
        },
      }),
      status: 409,
      message: "Já é indicado de Queens Burgers desde 30/09/2026",
    },
  ];

  for (const { name, input, status, message } of refusals) {
    test(`recusa: ${name}`, () => {
      assert.deepEqual(planManualReferralLink(input, NOW), { ok: false, status, message });
    });
  }

  test("usuário inexistente vence o status do afiliado (ordem da tabela R7)", () => {
    const decision = planManualReferralLink(
      state({ user: null, affiliate: { id: AFFILIATE_ID, status: "blocked", userId: "x" } }),
      NOW,
    );
    assert.deepEqual(decision, { ok: false, status: 404, message: "Usuário não encontrado" });
  });
});

describe("parseManualLinkReason", () => {
  test("aceita e apara o motivo", () => {
    assert.deepEqual(parseManualLinkReason("  veio por WhatsApp  "), { ok: true, reason: "veio por WhatsApp" });
  });

  const invalid: Array<[string, unknown]> = [
    ["vazio", ""],
    ["só espaços", "    "],
    ["não é texto", 42],
    ["ausente", undefined],
    ["acima de 500 caracteres", "x".repeat(501)],
  ];
  for (const [name, raw] of invalid) {
    test(`recusa motivo ${name}`, () => {
      assert.deepEqual(parseManualLinkReason(raw), {
        ok: false,
        message: "Informe o motivo do vínculo (até 500 caracteres)",
      });
    });
  }

  test("500 caracteres é o limite aceito", () => {
    assert.equal(parseManualLinkReason("x".repeat(500)).ok, true);
  });
});

describe("manualLinkActorAllowed", () => {
  test("só o cargo admin vincula", () => {
    assert.equal(manualLinkActorAllowed({ role: "admin" }), true);
    assert.equal(manualLinkActorAllowed({ role: "dev" }), false);
    assert.equal(manualLinkActorAllowed({ role: "marketing_consultant_premium" }), false);
    assert.equal(manualLinkActorAllowed({ role: "comercial" }), false);
  });
});

describe("describeManualLinkCharges", () => {
  test("nenhuma cobrança", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 0, netCentavos: 0, awaitingSettlementCount: 0 }),
      "Nenhuma cobrança paga até agora — só as próximas vão comissionar",
    );
  });
  test("uma cobrança, sem pendência de liquidação", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 1, netCentavos: 9700, awaitingSettlementCount: 0 }),
      "1 cobrança de assinatura paga · R$ 97,00 de líquido",
    );
  });
  test("várias cobranças, uma aguardando liquidação", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 6, netCentavos: 116400, awaitingSettlementCount: 1 }),
      "6 cobranças de assinatura pagas · R$ 1.164,00 de líquido · 1 aguardando liquidação",
    );
  });
  test("duas aguardando liquidação", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 2, netCentavos: 0, awaitingSettlementCount: 2 }),
      "2 cobranças de assinatura pagas · R$ 0,00 de líquido · 2 aguardando liquidação",
    );
  });
});

describe("describeManualLinkQuota", () => {
  test("vitalícia não tem aviso", () => {
    assert.equal(describeManualLinkQuota({ duration: "lifetime", durationCycles: null }, 6), null);
  });
  test("sem cobranças não tem aviso", () => {
    assert.equal(describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 0), null);
  });
  test("primeira venda: a mais antiga leva a única comissão", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "first_sale", durationCycles: null }, 4),
      "A cobrança mais antiga consome 1 de 1 comissão do acordo. As próximas cobranças não vão comissionar.",
    );
  });
  test("3 ciclos com 1 cobrança", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 1),
      "A cobrança mais antiga consome 1 de 3 comissões do acordo.",
    );
  });
  test("3 ciclos com 2 cobranças", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 2),
      "As 2 cobranças mais antigas consomem 2 de 3 comissões do acordo.",
    );
  });
  test("3 ciclos com 6 cobranças esgota a cota", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 6),
      "As 3 cobranças mais antigas consomem 3 de 3 comissões do acordo. As próximas cobranças não vão comissionar.",
    );
  });
});

describe("isReferralCustomerUserUniqueViolation", () => {
  const violation = { code: "23505", constraint_name: "referral_customers_user_id_unique" };
  test("o erro do postgres-js direto", () => {
    assert.equal(isReferralCustomerUserUniqueViolation(violation), true);
  });
  test("embrulhado pelo Drizzle em cause", () => {
    assert.equal(
      isReferralCustomerUserUniqueViolation(new Error("Failed query", { cause: violation })),
      true,
    );
  });
  test("outra trava única não conta", () => {
    assert.equal(
      isReferralCustomerUserUniqueViolation({ code: "23505", constraint_name: "users_email_unique" }),
      false,
    );
  });
  test("outro erro não conta", () => {
    assert.equal(isReferralCustomerUserUniqueViolation(new Error("boom")), false);
    assert.equal(isReferralCustomerUserUniqueViolation(null), false);
  });
  test("cause circular não trava", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    assert.equal(isReferralCustomerUserUniqueViolation(loop), false);
  });
});

describe("indexManualLinks", () => {
  test("indexa pelo customerId gravado em details e ignora linhas sem ele", () => {
    const links = indexManualLinks([
      { details: { customerId: "c1", userId: "u1" }, adminEmail: "a@x.com", createdAt: new Date("2026-10-11T12:00:00.000Z") },
      { details: null, adminEmail: "b@x.com", createdAt: new Date("2026-10-11T13:00:00.000Z") },
      { details: { customerId: 7 }, adminEmail: "c@x.com", createdAt: new Date("2026-10-11T14:00:00.000Z") },
    ]);
    assert.deepEqual([...links.entries()], [
      ["c1", { linkedAt: "2026-10-11T12:00:00.000Z", adminEmail: "a@x.com" }],
    ]);
  });
  test("se houver duas linhas para o mesmo indicado, vale a mais antiga", () => {
    const links = indexManualLinks([
      { details: { customerId: "c1" }, adminEmail: "late@x.com", createdAt: new Date("2026-10-12T12:00:00.000Z") },
      { details: { customerId: "c1" }, adminEmail: "first@x.com", createdAt: new Date("2026-10-11T12:00:00.000Z") },
    ]);
    assert.equal(links.get("c1")?.adminEmail, "first@x.com");
  });
});
