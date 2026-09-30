import { describe, expect, test } from "bun:test";

import type { AdAccountMoneyResponse } from "./ad-account-money-types";
import {
  BLOCKED_REASON_BISU,
  BLOCKED_REASON_USER,
  describeAdAccountMoney,
  formatOwedAmount,
  NO_MONEY_TEXT,
  statusTone,
} from "./describe-ad-account-money";

/** Intl usa espaço não separável entre símbolo e número; normalize para comparar. */
const plain = (value: string) => value.replace(/\s/g, " ");

function response(patch: Partial<AdAccountMoneyResponse>): AdAccountMoneyResponse {
  return {
    adAccountId: "123",
    name: "Loja Centro",
    currency: "BRL",
    isPrepaid: true,
    money: { kind: "available", display: "R$ 15,63" },
    accountStatus: 1,
    accountStatusLabel: "Ativa",
    fetchedAt: "2026-09-30T17:32:00.000Z",
    connectionKind: "bisu",
    ...patch,
  };
}

describe("describeAdAccountMoney", () => {
  test("pré-paga: rótulo Saldo disponível + texto da Meta intacto", () => {
    expect(describeAdAccountMoney(response({}))).toEqual({
      typeLabel: "Pré-paga",
      status: { label: "Ativa", tone: "neutral" },
      main: { kind: "amount", label: "Saldo disponível", value: "R$ 15,63" },
    });
  });

  test("texto da Meta que já diz 'saldo' não repete o rótulo", () => {
    const view = describeAdAccountMoney(
      response({ money: { kind: "available", display: "Saldo disponível (R$ 15,63 BRL)" } }),
    );
    expect(view.main).toEqual({ kind: "amount", label: null, value: "Saldo disponível (R$ 15,63 BRL)" });
    const upper = describeAdAccountMoney(
      response({ money: { kind: "available", display: "SALDO: R$ 1,00" } }),
    );
    expect(upper.main).toMatchObject({ label: null });
  });

  test("pós-paga: Fatura em aberto na moeda da conta", () => {
    const view = describeAdAccountMoney(
      response({ isPrepaid: false, money: { kind: "owed", amountMajor: 320 } }),
    );
    expect(view.typeLabel).toBe("Pós-paga");
    expect(view.main).toMatchObject({ kind: "amount", label: "Fatura em aberto" });
    expect(plain((view.main as { value: string }).value)).toBe("R$ 320,00");
  });

  test("bloqueado BISU explica o acesso de administrador", () => {
    const view = describeAdAccountMoney(
      response({ isPrepaid: null, money: { kind: "blocked" }, connectionKind: "bisu" }),
    );
    expect(view.typeLabel).toBeNull();
    expect(view.main).toEqual({ kind: "blocked", title: "Saldo indisponível", reason: BLOCKED_REASON_BISU });
    expect(BLOCKED_REASON_BISU).toBe(
      "A Meta só mostra o saldo para integrações com acesso de administrador. Peça ao cliente para conceder controle total (Administrador) desta conta de anúncios à Automatize no Gerenciador de Negócios e reconectar.",
    );
  });

  test("bloqueado token de usuário explica que quem conectou não é administrador", () => {
    const view = describeAdAccountMoney(
      response({ isPrepaid: null, money: { kind: "blocked" }, connectionKind: "user" }),
    );
    expect(view.main).toEqual({ kind: "blocked", title: "Saldo indisponível", reason: BLOCKED_REASON_USER });
    expect(BLOCKED_REASON_USER).toBe(
      "A Meta não devolveu o saldo para quem conectou esta conta — provavelmente não é administrador dela.",
    );
  });

  test("sem valor mostra o texto de ausência", () => {
    const view = describeAdAccountMoney(response({ isPrepaid: false, money: { kind: "none" } }));
    expect(view.main).toEqual({ kind: "empty", text: NO_MONEY_TEXT });
    expect(NO_MONEY_TEXT).toBe("A Meta não informou saldo nem fatura para esta conta.");
  });

  test("sem rótulo de status não há selo", () => {
    const view = describeAdAccountMoney(response({ accountStatus: null, accountStatusLabel: null }));
    expect(view.status).toBeNull();
  });

  test("selo usa o rótulo e o tom do status", () => {
    const view = describeAdAccountMoney(response({ accountStatus: 3, accountStatusLabel: "Não quitada" }));
    expect(view.status).toEqual({ label: "Não quitada", tone: "warning" });
  });
});

describe("statusTone", () => {
  test("Ativa é neutro", () => {
    expect(statusTone(1)).toBe("neutral");
  });
  test("dinheiro travando a veiculação é âmbar", () => {
    for (const s of [3, 8, 9]) expect(statusTone(s)).toBe("warning");
  });
  test("conta parada ou fechada é destrutivo", () => {
    for (const s of [2, 7, 100, 101]) expect(statusTone(s)).toBe("destructive");
  });
  test("desconhecido ou ausente é contorno", () => {
    expect(statusTone(null)).toBe("outline");
    expect(statusTone(0)).toBe("outline");
    expect(statusTone(201)).toBe("outline");
  });
});

describe("formatOwedAmount", () => {
  test("fatura zero formata R$ 0,00", () => {
    expect(plain(formatOwedAmount(0, "BRL"))).toBe("R$ 0,00");
  });
  test("moeda da conta é respeitada", () => {
    expect(plain(formatOwedAmount(1234.56, "USD"))).toBe("US$ 1.234,56");
  });
  test("moeda ausente cai em BRL", () => {
    expect(plain(formatOwedAmount(10, null))).toBe("R$ 10,00");
  });
  test("moeda inválida cai em BRL", () => {
    expect(plain(formatOwedAmount(10, "invalid"))).toBe("R$ 10,00");
  });
});
