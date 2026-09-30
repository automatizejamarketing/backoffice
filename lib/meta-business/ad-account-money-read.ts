/**
 * Saldo (pré-paga) ou fatura em aberto (pós-paga) + status de UMA conta de
 * anúncios, lido com o token do cliente para o card "Saldo / fatura na Meta"
 * do backoffice. A regra de dinheiro é a do app do cliente — vem das funções
 * espelhadas de `marketing/ad-account-money.ts`, nunca reescrita aqui.
 *
 * Não é espelhado pelo `sync:meta`: o app lê o dinheiro na listagem de contas
 * (`/me/adaccounts` / `assigned_ad_accounts`); o backoffice lê a conta escolhida.
 */
import type {
  AdAccountMoneyRead,
  AdAccountMoneyState,
} from "@/lib/backoffice/ad-account-money-types";
import { stripActPrefix, withActPrefix } from "@/lib/meta-business/account-match";
import { GraphApiError } from "@/lib/meta-business/error";
import { getAccountStatusLabel } from "@/lib/meta-business/insights/account";
import { callMeta } from "@/lib/meta-business/insights/client";
import {
  isAdAccountMoneyBlockedByPermission,
  resolveAdAccountMoney,
} from "@/lib/meta-business/marketing/ad-account-money";
import { cachedMetaRead, tokenCacheId } from "@/lib/meta-business/read-cache";

/** Mesmo frescor do app do cliente (read-cache de 5 min da listagem de contas). */
const AD_ACCOUNT_MONEY_CACHE_TTL_MS = 5 * 60 * 1000;

const IDENTITY_FIELDS = "name,currency,account_status";
/**
 * A Meta gateia por tarefa na conta: `funding_source_details` exige MANAGE e
 * `is_prepay_account` exige MANAGE ou ADVERTISE; `balance` não exige nenhuma.
 */
const MONEY_FIELDS = "balance,is_prepay_account,funding_source_details{display_string}";

type RawAdAccount = {
  name?: string;
  currency?: string;
  account_status?: number;
  balance?: string | number;
  is_prepay_account?: boolean;
  funding_source_details?: { display_string?: string };
};

/**
 * Recusa por permissão ou por campo (10, 100, 200–299): a leitura só de
 * identidade ainda pode passar. Token inválido (190/102), rate limit e erros
 * transitórios NÃO entram — degradar ali esconderia o problema real atrás de um
 * "Saldo indisponível".
 */
export function isMoneyFieldRejection(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false;
  const code = error.errorReturn.data?.code;
  if (typeof code !== "number") return false;
  return code === 10 || code === 100 || (code >= 200 && code <= 299);
}

function fetchAdAccount(
  adAccountId: string,
  accessToken: string,
  fields: string,
): Promise<RawAdAccount> {
  return callMeta<RawAdAccount>({
    domain: "FACEBOOK",
    method: "GET",
    path: withActPrefix(adAccountId),
    params: `fields=${fields}`,
    accessToken,
  });
}

function resolveMoneyState(
  raw: RawAdAccount,
  moneyFieldsRejected: boolean,
): AdAccountMoneyState {
  if (moneyFieldsRejected) return { kind: "blocked" };
  const money = resolveAdAccountMoney(raw);
  if (money) return money;
  if (isAdAccountMoneyBlockedByPermission(raw)) return { kind: "blocked" };
  return { kind: "none" };
}

async function readAdAccountMoneyUncached(
  adAccountId: string,
  accessToken: string,
): Promise<AdAccountMoneyRead> {
  let raw: RawAdAccount;
  let moneyFieldsRejected = false;
  try {
    raw = await fetchAdAccount(adAccountId, accessToken, `${IDENTITY_FIELDS},${MONEY_FIELDS}`);
  } catch (error) {
    if (!isMoneyFieldRejection(error)) throw error;
    console.warn("backoffice.adAccountMoney.moneyFieldsRejected", {
      adAccountId,
      code: (error as GraphApiError).errorReturn.data?.code,
    });
    raw = await fetchAdAccount(adAccountId, accessToken, IDENTITY_FIELDS);
    moneyFieldsRejected = true;
  }

  const accountStatus = typeof raw.account_status === "number" ? raw.account_status : null;
  return {
    adAccountId,
    name: raw.name ?? null,
    currency: raw.currency ?? null,
    isPrepaid:
      !moneyFieldsRejected && typeof raw.is_prepay_account === "boolean"
        ? raw.is_prepay_account
        : null,
    money: resolveMoneyState(raw, moneyFieldsRejected),
    accountStatus,
    accountStatusLabel: accountStatus === null ? null : getAccountStatusLabel(accountStatus),
    fetchedAt: new Date().toISOString(),
  };
}

/** Lê o dinheiro e o status da conta; `fresh` ignora a entrada fresca do cache. */
export async function readAdAccountMoney(args: {
  adAccountId: string;
  accessToken: string;
  fresh?: boolean;
}): Promise<AdAccountMoneyRead> {
  const digits = stripActPrefix(args.adAccountId);
  return cachedMetaRead({
    key: `acctmoney:${tokenCacheId(args.accessToken)}:${digits}`,
    ttlMs: AD_ACCOUNT_MONEY_CACHE_TTL_MS,
    forceRefresh: args.fresh === true,
    fetcher: () => readAdAccountMoneyUncached(digits, args.accessToken),
  });
}
