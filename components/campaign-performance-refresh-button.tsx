"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Triggers an immediate pull of this user's [AM] campaign performance from the
// Meta API (rolling last 7 days), so admins don't have to wait for the weekly
// cron. Writes the same campaign_performance_snapshots the banner reads.
export function CampaignPerformanceRefreshButton({
  userId,
  variant = "secondary",
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
        `/api/users/${userId}/marketing/campaign-performance/refresh`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao atualizar performance");
      }
      if (data.errorMessage) {
        toast.warning(data.errorMessage);
      } else if (!data.campaignsSaved) {
        toast.info("Nenhuma campanha [AM] encontrada no período.");
      } else {
        toast.success(
          `${data.campaignsSaved} campanha(s) [AM] de performance atualizada(s).`,
        );
      }
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao atualizar performance",
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
      <TrendingUp className={`size-4 ${isRefreshing ? "animate-pulse" : ""}`} />
      Atualizar performance
    </Button>
  );
}
