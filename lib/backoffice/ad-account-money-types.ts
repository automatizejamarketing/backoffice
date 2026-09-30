import type { ReconnectInfo } from "@/lib/meta-business/reconnect-link";

/**
 * O dinheiro da conta de anúncios, na regra do app do cliente
 * (`lib/meta-business/marketing/ad-account-money.ts`, espelhado):
 * - `available`: pré-paga — `funding_source_details.display_string`, sem alterar;
 * - `owed`: pós-paga — `balance / 100`, a "Fatura em aberto" (dívida, não saldo);
 * - `blocked`: a Meta escondeu os campos por permissão (tarefa MANAGE/ADVERTISE);
 * - `none`: não há valor para mostrar.
 */
export type AdAccountMoneyState =
  | { kind: "available"; display: string }
  | { kind: "owed"; amountMajor: number }
  | { kind: "blocked" }
  | { kind: "none" };

export type AdAccountMoneyRead = {
  /** Só dígitos, sem `act_`. */
  adAccountId: string;
  name: string | null;
  /** Código ISO da moeda da conta (ex.: "BRL"). */
  currency: string | null;
  /** null quando a Meta não devolveu `is_prepay_account`. */
  isPrepaid: boolean | null;
  money: AdAccountMoneyState;
  accountStatus: number | null;
  /** null quando `accountStatus` é null. */
  accountStatusLabel: string | null;
  /** ISO 8601 do momento da leitura real na Meta (um valor do cache mantém a hora original). */
  fetchedAt: string;
};

export type AdAccountMoneyConnectionKind = "bisu" | "user";

/** Corpo 200 de `GET /api/users/[id]/ad-accounts/[accountId]/money`. */
export type AdAccountMoneyResponse = AdAccountMoneyRead & {
  connectionKind: AdAccountMoneyConnectionKind;
};

/** Corpo de erro da mesma rota — o formato do `/api/users/[id]/ad-accounts`. */
export type AdAccountMoneyErrorResponse = {
  error: string;
  message: string;
  solution?: string;
  correlationId?: string;
  code?: number;
  errorSubcode?: number;
  needsReconnect?: boolean;
  reconnect?: ReconnectInfo;
};
