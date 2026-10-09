"use client";

import { useQuery } from "@tanstack/react-query";
import { StatusBadgeWithHint } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { MarketingAccountStatusResponse } from "@/app/api/users/[id]/account-status/route";

export function MarketingAccountStatus({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ["marketing-account-status", userId],
    queryFn: async (): Promise<MarketingAccountStatusResponse> => {
      const response = await fetch(`/api/users/${userId}/account-status`);
      if (!response.ok) throw new Error("Status da conta indisponível");
      return response.json();
    },
  });

  if (query.isPending) {
    return <p className="text-xs text-muted-foreground">Carregando status da conta...</p>;
  }
  if (query.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Status da conta indisponível</span>
        <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div aria-label="Status da conta do cliente" className="flex flex-wrap items-start gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span>Conta do cliente</span>
        <StatusBadgeWithHint badge={query.data.access} className="flex-row flex-wrap items-center gap-2" />
      </div>
      {query.data.billing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Assinatura</span>
          <StatusBadgeWithHint badge={query.data.billing} className="flex-row flex-wrap items-center gap-2" />
        </div>
      ) : null}
    </div>
  );
}
