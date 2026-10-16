"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TRAFEGO_VIEWS, viewFromPathname, type TrafegoView } from "./routes";

/**
 * Troca entre Mesa e CRM. Estando numa delas, só muda a URL
 * (history.pushState — o Next sincroniza usePathname/useSearchParams e o
 * botão voltar), sem ida ao servidor; vindo de outra tela, navega normal.
 */
export function useSwitchView() {
  const pathname = usePathname();
  const router = useRouter();
  return useCallback(
    (view: TrafegoView, search = "") => {
      const base = TRAFEGO_VIEWS.find((entry) => entry.key === view)?.href ?? "/trafego";
      const href = `${base}${search ? `?${search}` : ""}`;
      if (viewFromPathname(pathname)) window.history.pushState(null, "", href);
      else router.push(href);
    },
    [pathname, router],
  );
}
