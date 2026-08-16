/**
 * Ad account context: currency, timezone, spend, cap, balance.
 *
 * This is a NEW field read — the existing layer only surfaces currency/balance
 * via `/me`. Date presets must resolve in the ACCOUNT timezone (design §4.1, §8),
 * so the agent needs `timezone_name`. Cached once per session by the route.
 *
 * `amount_spent`, `spend_cap`, `balance` are MINOR units (cents) → converted here.
 */
import { callMeta, formatAccountId } from "./client";
import { minorToMajor, toNumber } from "./currency";
import { resolveAdAccountMoney } from "../marketing/ad-account-money";
import { cachedMetaRead, tokenCacheId } from "@/lib/meta-business/read-cache";

/**
 * Moeda/timezone nunca mudam; saldo e gasto andam devagar e a própria Meta os
 * entrega com atraso. 5 minutos de frescor cobrem o fluxo de IA inteiro (scan →
 * plan → create resolvia este contexto de novo em cada rota) sem mostrar um
 * saldo relevante desatualizado.
 */
const ACCOUNT_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;

export type AccountContext = {
  /** Numeric ad account id (no `act_` prefix). */
  adAccountId: string;
  name: string | null;
  currency: string;
  timezoneName: string;
  /** Total spent on the account, major units. */
  amountSpent: number | null;
  /** Account spend cap, major units. null when uncapped. */
  spendCap: number | null;
  /** True when the account prepays (funds held with Meta). */
  isPrepaid: boolean;
  /**
   * PREPAID accounts only: the spendable "Saldo disponível" as Meta's own
   * formatted string (e.g. "R$ 15,63"). null for postpaid accounts (which have
   * no prepaid balance). THIS is the number to report as "saldo" — NOT `balance`.
   */
  availableBalanceDisplay: string | null;
  /**
   * POSTPAID only: amount OWED (`balance`, major units) — a debt / "Fatura em
   * aberto", NOT available funds. null for prepaid accounts. See docs/CONTEXT.md
   * "Saldo disponível vs Fatura em aberto".
   */
  balance: number | null;
  accountStatus: number | null;
  accountStatusLabel: string;
  /**
   * Meta's minimum daily budget for ONE ad set in this account, in MINOR units (cents). Meta's own
   * number — never guess it: it varies by currency and by billing event.
   */
  minDailyBudgetCents: number | null;
};

type RawAccount = {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  amount_spent?: string;
  spend_cap?: string;
  balance?: string;
  is_prepay_account?: boolean;
  funding_source_details?: { display_string?: string };
  account_status?: number;
  min_daily_budget?: string | number;
};

const ACCOUNT_STATUS_PT: Record<number, string> = {
  1: "Ativa",
  2: "Desativada",
  3: "Não quitada",
  7: "Em revisão de risco",
  8: "Aguardando pagamento",
  9: "Em período de carência",
  100: "Fechamento pendente",
  101: "Fechada",
};

/** Fetch and normalize the ad account context. Throws on Graph error. */
export async function fetchAccountContext(args: {
  adAccountId: string;
  accessToken: string;
}): Promise<AccountContext> {
  return cachedMetaRead({
    key: `acctctx:${tokenCacheId(args.accessToken)}:${args.adAccountId.replace(/^act_/, "")}`,
    ttlMs: ACCOUNT_CONTEXT_CACHE_TTL_MS,
    fetcher: () => fetchAccountContextUncached(args),
  });
}

async function fetchAccountContextUncached(args: {
  adAccountId: string;
  accessToken: string;
}): Promise<AccountContext> {
  const formattedAccountId = formatAccountId(args.adAccountId);
  const fields = [
    "name",
    "currency",
    "timezone_name",
    "amount_spent",
    "spend_cap",
    "balance",
    "is_prepay_account",
    "funding_source_details{display_string}",
    "account_status",
    // Meta's OWN floor for an ad set's daily budget in this account's currency. Splitting one daily
    // budget across N ad sets (the AI flow's 1-N-1) can dive under it — better to say so on the
    // review than to have Meta refuse the 3rd ad set after the user approved.
    "min_daily_budget",
  ].join(",");

  const raw = await callMeta<RawAccount>({
    domain: "FACEBOOK",
    method: "GET",
    path: formattedAccountId,
    params: `fields=${fields}`,
    accessToken: args.accessToken,
  });

  const spendCapMajor = minorToMajor(raw.spend_cap);
  // Prepaid-aware money: PREPAID → spendable display_string; POSTPAID → owed.
  const money = resolveAdAccountMoney(raw);

  return {
    adAccountId: raw.account_id ?? args.adAccountId.replace(/^act_/, ""),
    name: raw.name ?? null,
    currency: raw.currency ?? "BRL",
    timezoneName: raw.timezone_name ?? "America/Sao_Paulo",
    amountSpent: minorToMajor(raw.amount_spent),
    // spend_cap "0" means "no cap" in Meta — surface as null (unlimited).
    spendCap: spendCapMajor && spendCapMajor > 0 ? spendCapMajor : null,
    isPrepaid: Boolean(raw.is_prepay_account),
    availableBalanceDisplay:
      money?.kind === "available" ? money.display : null,
    // Only postpaid carries a meaningful "owed" balance; prepaid → null so the
    // misleading residual (e.g. R$ 2,45) is never surfaced as "saldo".
    balance: money?.kind === "owed" ? money.amountMajor : null,
    accountStatus: raw.account_status ?? null,
    accountStatusLabel:
      raw.account_status != null
        ? (ACCOUNT_STATUS_PT[raw.account_status] ?? "Desconhecida")
        : "Desconhecida",
    // Budgets are MINOR units on Meta — keep it that way (this one is compared against ad-set
    // budgets, which are also cents). `toNumber` guards the junk: an empty string would otherwise
    // read as a floor of ZERO and silently disable every check built on it.
    minDailyBudgetCents: toNumber(raw.min_daily_budget),
  };
}
