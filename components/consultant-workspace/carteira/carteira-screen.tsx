"use client";

import { useSearchParams } from "next/navigation";
import { LoadError } from "@/components/consultant-workspace/common/load-error";
import { parseDays } from "@/components/consultant-workspace/common/routes";
import { useCarteiraData, usePrefetchSibling } from "@/components/consultant-workspace/common/use-trafego-data";
import { Carteira } from "./carteira";
import type { ViewMode } from "./filters";
import { CarteiraSkeleton } from "./skeletons";

/**
 * Fila e Mesa leem a carteira do cache (react-query): voltar a uma visão já
 * vista pinta na hora e relê em segundo plano se passou de 2 minutos. O
 * esqueleto só aparece na primeira leitura do período.
 */
export function CarteiraScreen({ mode }: { mode: ViewMode }) {
  const params = useSearchParams();
  const days = parseDays(params.get("dias"));
  const query = useCarteiraData(days);
  usePrefetchSibling("carteira", query.isSuccess && !query.isPlaceholderData);

  if (!query.data) {
    return query.isError ? (
      <LoadError what="a carteira" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
    ) : (
      <CarteiraSkeleton mode={mode} />
    );
  }
  return (
    <Carteira
      data={query.data}
      now={query.data.now}
      mode={mode}
      days={days}
      periodPending={query.isPlaceholderData}
    />
  );
}
