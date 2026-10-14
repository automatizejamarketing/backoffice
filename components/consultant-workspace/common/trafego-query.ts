/**
 * Cache das visões de Tráfego (react-query): chaves, tempos, URLs e o formato
 * das respostas. Puro — os hooks moram em `use-trafego-data.ts`.
 *
 * Fila e Mesa leem a carteira de um período; Jornada e Playbooks, o quadro
 * (sempre 7 dias). Tudo debaixo de ["trafego"] para invalidar de uma vez.
 */
import type { CarteiraData } from "@/components/consultant-workspace/carteira/types";
import type { BoardData } from "@/components/consultant-workspace/jornada/lib";
import { parseDays, type TrafegoView } from "./routes";

/** `now`: o relógio do servidor na leitura — base dos tempos relativos (nunca `Date.now()` no render). */
export type CarteiraPayload = CarteiraData & { now: number };
export type BoardPayload = BoardData & { now: number };

export const TRAFEGO_ROOT_KEY = ["trafego"] as const;
/** Métricas vão só até ontem: 2 minutos sem reler não mudam nada para o consultor. */
export const TRAFEGO_STALE_MS = 2 * 60_000;
/** Voltar a uma visão vista há até meia hora pinta na hora (e relê em segundo plano). */
export const TRAFEGO_GC_MS = 30 * 60_000;

export const trafegoKeys = {
  all: TRAFEGO_ROOT_KEY,
  carteira: (days: number) => ["trafego", "carteira", parseDays(String(days))] as const,
  board: () => ["trafego", "board"] as const,
};

export function carteiraUrl(days: number) {
  return `/api/consultant-workspace/carteira?dias=${parseDays(String(days))}`;
}

export const BOARD_URL = "/api/consultant-workspace/board";

export type TrafegoDataset = { kind: "carteira"; days: number } | { kind: "board" };

/** O que cada visão lê; `search` é a query string que o link leva (o período mora em `dias`). */
export function datasetOfView(view: TrafegoView, search = ""): TrafegoDataset {
  if (view === "jornada") return { kind: "board" };
  return { kind: "carteira", days: parseDays(new URLSearchParams(search).get("dias")) };
}

/** A visão "irmã" que vale aquecer: quem abriu a Fila/Mesa provavelmente vai à Jornada, e vice-versa. */
export function siblingDataset(current: TrafegoDataset["kind"]): TrafegoDataset {
  return current === "board" ? { kind: "carteira", days: 7 } : { kind: "board" };
}
