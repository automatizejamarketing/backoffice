"use client";

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AdAccountMoneyErrorResponse,
  AdAccountMoneyResponse,
} from "@/lib/backoffice/ad-account-money-types";

/** Mesmo frescor do cache do servidor: trocar de conta e voltar não relê a Meta. */
const AD_ACCOUNT_MONEY_STALE_MS = 5 * 60 * 1000;

export const adAccountMoneyQueryKey = (userId: string, accountId: string) =>
  ["ad-account-money", userId, accountId] as const;

export class AdAccountMoneyRequestError extends Error {
  constructor(
    readonly body: AdAccountMoneyErrorResponse | null,
    readonly status: number,
  ) {
    super(body?.message ?? "request_failed");
    this.name = "AdAccountMoneyRequestError";
  }
}

export async function fetchAdAccountMoney(
  userId: string,
  accountId: string,
  fresh: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<AdAccountMoneyResponse> {
  const url = `/api/users/${encodeURIComponent(userId)}/ad-accounts/${encodeURIComponent(accountId)}/money${fresh ? "?fresh=1" : ""}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as AdAccountMoneyErrorResponse | null;
    throw new AdAccountMoneyRequestError(body, response.status);
  }
  return (await response.json()) as AdAccountMoneyResponse;
}

/**
 * Leitura forçada ("Atualizar"). A conta vem como ARGUMENTO, não do render: se o
 * operador trocar de conta com a leitura em voo, o dado cai na conta atualizada.
 */
export async function refreshAdAccountMoney(
  queryClient: QueryClient,
  userId: string,
  accountId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdAccountMoneyResponse> {
  const data = await fetchAdAccountMoney(userId, accountId, true, fetchImpl);
  queryClient.setQueryData(adAccountMoneyQueryKey(userId, accountId), data);
  return data;
}

export function useAdAccountMoney(userId: string, accountId: string) {
  return useQuery({
    queryKey: adAccountMoneyQueryKey(userId, accountId),
    queryFn: () => fetchAdAccountMoney(userId, accountId, false),
    enabled: Boolean(userId && accountId),
    staleTime: AD_ACCOUNT_MONEY_STALE_MS,
    // Cada tentativa é uma chamada à Meta; o operador tem "Tentar de novo".
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useRefreshAdAccountMoney(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => refreshAdAccountMoney(queryClient, userId, accountId),
  });
}
