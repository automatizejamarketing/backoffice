import type { AdAccountMoneyResponse } from "./ad-account-money-types";

export type AdAccountMoneyTone = "neutral" | "warning" | "destructive" | "outline";

/** O que o card "Saldo / fatura na Meta" desenha — decidido aqui, sem React. */
export type AdAccountMoneyView = {
  typeLabel: "Pré-paga" | "Pós-paga" | null;
  status: { label: string; tone: AdAccountMoneyTone } | null;
  main:
    | { kind: "amount"; label: string | null; value: string }
    | { kind: "blocked"; title: "Saldo indisponível"; reason: string }
    | { kind: "empty"; text: string };
};

export const BLOCKED_REASON_BISU =
  "A Meta só mostra o saldo para integrações com acesso de administrador. Peça ao cliente para conceder controle total (Administrador) desta conta de anúncios à Automatize no Gerenciador de Negócios e reconectar.";
export const BLOCKED_REASON_USER =
  "A Meta não devolveu o saldo para quem conectou esta conta — provavelmente não é administrador dela.";
export const NO_MONEY_TEXT = "A Meta não informou saldo nem fatura para esta conta.";

/** Não quitada, Aguardando pagamento, Em período de carência: o dinheiro trava a veiculação. */
const WARNING_STATUSES = new Set([3, 8, 9]);
/** Desativada, Em revisão de risco, Fechamento pendente, Fechada. */
const DESTRUCTIVE_STATUSES = new Set([2, 7, 100, 101]);

export function statusTone(status: number | null): AdAccountMoneyTone {
  if (status === null) return "outline";
  if (status === 1) return "neutral";
  if (WARNING_STATUSES.has(status)) return "warning";
  if (DESTRUCTIVE_STATUSES.has(status)) return "destructive";
  return "outline";
}

/** Fatura em aberto na moeda da conta; moeda ausente ou inválida → BRL. */
export function formatOwedAmount(amountMajor: number, currency: string | null): string {
  const format = (code: string) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(amountMajor);
  if (currency) {
    try {
      return format(currency);
    } catch {
      // Código malformado: o Intl recusa — cai no BRL abaixo.
    }
  }
  return format("BRL");
}

function describeMain(response: AdAccountMoneyResponse): AdAccountMoneyView["main"] {
  const { money } = response;
  switch (money.kind) {
    case "available":
      // O texto é da Meta e vai sem alteração; às vezes ele já traz "Saldo disponível (…)".
      return {
        kind: "amount",
        label: /saldo/i.test(money.display) ? null : "Saldo disponível",
        value: money.display,
      };
    case "owed":
      return {
        kind: "amount",
        label: "Fatura em aberto",
        value: formatOwedAmount(money.amountMajor, response.currency),
      };
    case "blocked":
      return {
        kind: "blocked",
        title: "Saldo indisponível",
        reason: response.connectionKind === "bisu" ? BLOCKED_REASON_BISU : BLOCKED_REASON_USER,
      };
    case "none":
      return { kind: "empty", text: NO_MONEY_TEXT };
  }
}

export function describeAdAccountMoney(response: AdAccountMoneyResponse): AdAccountMoneyView {
  return {
    typeLabel: response.isPrepaid === null ? null : response.isPrepaid ? "Pré-paga" : "Pós-paga",
    status:
      response.accountStatusLabel === null
        ? null
        : { label: response.accountStatusLabel, tone: statusTone(response.accountStatus) },
    main: describeMain(response),
  };
}
