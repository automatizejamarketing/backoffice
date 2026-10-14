"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { viewFromPathname, type TrafegoView } from "./routes";

/**
 * Troca entre Fila, Mesa e Jornada. Estando numa delas, só muda a URL
 * (history.pushState — o Next sincroniza usePathname/useSearchParams e o
 * botão voltar), sem ida ao servidor; vindo de outra tela, navega normal.
 */
export function useSwitchView() {
  const pathname = usePathname();
  const router = useRouter();
  return useCallback(
    (view: TrafegoView, search = "") => {
      const href = `/trafego/${view}${search ? `?${search}` : ""}`;
      if (viewFromPathname(pathname)) window.history.pushState(null, "", href);
      else router.push(href);
    },
    [pathname, router],
  );
}
