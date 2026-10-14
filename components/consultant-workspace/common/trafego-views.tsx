"use client";

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { CarteiraScreen } from "@/components/consultant-workspace/carteira/carteira-screen";
import { CarteiraSkeleton } from "@/components/consultant-workspace/carteira/skeletons";
import { JourneyBoardScreen } from "@/components/consultant-workspace/jornada/board-screen";
import { BoardSkeleton } from "@/components/consultant-workspace/jornada/skeletons";
import { TRAFEGO_VIEWS, viewFromPathname } from "./routes";

/**
 * Escolhe a visão pela URL. Como a troca entre visões é feita com
 * history.pushState (ver useSwitchView), o Next atualiza usePathname sem ir ao
 * servidor, e os dados já estão no cache: a troca é imediata.
 */
export function TrafegoViews() {
  const pathname = usePathname();
  const view = viewFromPathname(pathname) ?? "jornada";

  useEffect(() => {
    const label = TRAFEGO_VIEWS.find((entry) => entry.key === view)?.label ?? "Tráfego";
    document.title = `${label} · Tráfego`;
  }, [view]);

  if (view === "jornada") {
    return (
      <Suspense fallback={<BoardSkeleton />}>
        <JourneyBoardScreen />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<CarteiraSkeleton mode={view === "mesa" ? "tabela" : "fila"} />}>
      <CarteiraScreen key={view} mode={view === "mesa" ? "tabela" : "fila"} />
    </Suspense>
  );
}
