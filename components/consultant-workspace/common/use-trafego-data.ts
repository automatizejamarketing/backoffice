"use client";

import { useCallback, useEffect } from "react";
import { keepPreviousData, queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  BOARD_URL,
  TRAFEGO_GC_MS,
  TRAFEGO_ROOT_KEY,
  TRAFEGO_STALE_MS,
  carteiraUrl,
  datasetOfView,
  siblingDataset,
  trafegoKeys,
  type BoardPayload,
  type CarteiraPayload,
  type TrafegoDataset,
} from "./trafego-query";
import type { TrafegoView } from "./routes";

async function getJson<T>(url: string): Promise<T> {
  // Sem AbortSignal de propósito: trocar de visão no meio da leitura não joga fora o trabalho do servidor.
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Falha ao carregar (${response.status})`);
  }
  return (await response.json()) as T;
}

export function carteiraQuery(days: number) {
  return queryOptions({
    queryKey: trafegoKeys.carteira(days),
    queryFn: () => getJson<CarteiraPayload>(carteiraUrl(days)),
    staleTime: TRAFEGO_STALE_MS,
    gcTime: TRAFEGO_GC_MS,
    retry: 1,
  });
}

export function boardQuery() {
  return queryOptions({
    queryKey: trafegoKeys.board(),
    queryFn: () => getJson<BoardPayload>(BOARD_URL),
    staleTime: TRAFEGO_STALE_MS,
    gcTime: TRAFEGO_GC_MS,
    retry: 1,
  });
}

function prefetchDataset(queryClient: QueryClient, dataset: TrafegoDataset) {
  // prefetchQuery respeita o staleTime: com cache fresco, não vai ao servidor.
  return dataset.kind === "board"
    ? queryClient.prefetchQuery(boardQuery())
    : queryClient.prefetchQuery(carteiraQuery(dataset.days));
}

/**
 * Fila e Mesa. Trocar o período mantém a tela anterior até o novo chegar
 * (`isPlaceholderData`); voltar a um período já visto é imediato.
 */
export function useCarteiraData(days: number) {
  return useQuery({ ...carteiraQuery(days), placeholderData: keepPreviousData });
}

/** Jornada e Playbooks (sempre 7 dias). */
export function useBoardData() {
  return useQuery(boardQuery());
}

/** Com a visão pronta, aquece a irmã (carteira 7d ↔ quadro) em segundo plano. */
export function usePrefetchSibling(current: TrafegoDataset["kind"], ready: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    // Deixa a tela atual pintar antes de pedir a outra leitura.
    const timer = window.setTimeout(() => void prefetchDataset(queryClient, siblingDataset(current)), 400);
    return () => window.clearTimeout(timer);
  }, [current, ready, queryClient]);
}

/** Para o hover dos links da barra: aquece o que a visão vai ler. */
export function usePrefetchView() {
  const queryClient = useQueryClient();
  return useCallback(
    (view: TrafegoView, search: string) => void prefetchDataset(queryClient, datasetOfView(view, search)),
    [queryClient],
  );
}

/**
 * Depois de mexer na Meta ou mandar mensagem: marca as visões como velhas. A
 * que estiver aberta relê em segundo plano; as outras, na próxima visita.
 * Não espere a promessa — a leitura da carteira é pesada.
 */
export function invalidateTrafego(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: TRAFEGO_ROOT_KEY });
}
