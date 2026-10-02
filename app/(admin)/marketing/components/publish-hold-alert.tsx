"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

type PublishHoldRow = {
  id: string;
  flow: string;
  status: string;
  adAccountId: string;
  campaignName: string | null;
  reasonCode: string;
  createdAt: string;
};

export function PublishHoldAlert({ userId }: { userId: string }) {
  const [holds, setHolds] = useState<PublishHoldRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}/meta-account/publish-holds`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { holds?: PublishHoldRow[] } | null) => {
        if (!cancelled) setHolds(data?.holds ?? []);
      })
      .catch(() => {
        if (!cancelled) setHolds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (holds.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline">Certificação Meta</Badge>
        <p className="text-sm font-medium text-foreground">
          {holds.length === 1
            ? "1 publicação esperando o consultor"
            : `${holds.length} publicações esperando o consultor`}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        O token do cliente e o token do consultor não publicaram. Se o
        Gerenciador de Negócios for recente, o cliente precisa convidar a
        Automatize em Pessoas. Depois reconecte com o seu Facebook.
      </p>
      <ul className="space-y-1 text-sm text-foreground">
        {holds.map((hold) => (
          <li key={hold.id}>
            {hold.campaignName?.trim() || "Campanha sem nome"} · {hold.adAccountId}
          </li>
        ))}
      </ul>
    </div>
  );
}
