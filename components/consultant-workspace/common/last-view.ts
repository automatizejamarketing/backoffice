"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Última visão aberta (com filtros), para a página do cliente voltar ao mesmo
 * lugar. Fica só nesta aba.
 */
const KEY = "trafego:ultima-visao";

function subscribeNothing() {
  return () => {};
}

function read(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Guarda a URL atual da visão sempre que ela (ou a query string) muda. */
export function useRememberView(query: string) {
  useEffect(() => {
    try {
      window.sessionStorage.setItem(KEY, `${window.location.pathname}${window.location.search}`);
    } catch {
      // sem sessionStorage: o "voltar" só não lembra os filtros
    }
  }, [query]);
}

const VIEW_LABEL: Array<[string, string]> = [
  ["/trafego/fila", "Fila"],
  ["/trafego/mesa", "Mesa"],
  ["/trafego/jornada", "Jornada"],
  ["/trafego/playbooks", "Playbooks"],
  ["/trafego/mensagens", "Mensagens"],
  ["/trafego/adiados", "Adiados"],
];

/** Link e rótulo de volta para a última visão (padrão: a visão escolhida em /trafego). */
export function useLastView(): { href: string; label: string } {
  const href = useSyncExternalStore(subscribeNothing, read, () => null) ?? "/trafego";
  const label = VIEW_LABEL.find(([path]) => href.startsWith(path))?.[1] ?? "Tráfego";
  return { href, label };
}
