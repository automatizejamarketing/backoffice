"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ManagedCampaignRefreshButton({
  userId,
  variant = "outline",
}: {
  userId: string;
  variant?: "outline" | "secondary";
}) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refresh() {
    setIsRefreshing(true);
    try {
      const response = await fetch(
        `/api/users/${userId}/business/managed-campaigns/refresh`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao atualizar campanhas");
      }
      if (data.errorMessage) {
        toast.warning(data.errorMessage);
      } else {
        toast.success("Status de campanha gerenciada atualizado");
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
      variant={variant}
      size="sm"
      onClick={refresh}
      disabled={isRefreshing}
    >
      <RefreshCw
        className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
      />
      Atualizar Meta
    </Button>
  );
}
