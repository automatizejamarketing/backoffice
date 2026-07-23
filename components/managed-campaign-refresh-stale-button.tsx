"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ManagedCampaignRefreshStaleButton({
  staleCount,
}: {
  staleCount: number;
}) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refreshStale() {
    setIsRefreshing(true);
    try {
      const response = await fetch(
        "/api/backoffice/business/managed-campaigns/refresh-stale",
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao atualizar campanhas");
      }

      if (data.refreshed === 0) {
        toast.info("Nenhuma Meta pendente para atualizar hoje");
      } else if (data.errors > 0) {
        toast.warning(
          `Atualizadas ${data.refreshed} conta(s), com ${data.errors} alerta(s).`,
        );
      } else {
        toast.success(`Atualizadas ${data.refreshed} conta(s) pendente(s).`);
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Erro ao atualizar campanhas",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={refreshStale}
      disabled={isRefreshing || staleCount === 0}
    >
      <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
      Atualizar pendentes
      {staleCount > 0 && (
        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs">
          {staleCount}
        </span>
      )}
    </Button>
  );
}
