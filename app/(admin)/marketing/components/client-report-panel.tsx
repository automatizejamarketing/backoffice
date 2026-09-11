"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Snapshot = {
  id: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  headlineState: string;
  monthsPaidBack: string | null;
  deliveredAt: string | null;
  payload: {
    headline?: { title?: string; subtitle?: string };
    scorecard?: { spend?: number; purchaseValue?: number };
  } | null;
};

export function ClientReportPanel({ userId }: { userId: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${userId}/client-reports`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar relatórios");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setSnapshots(data.snapshots ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Relatório do cliente</CardTitle>
        <p className="text-xs text-muted-foreground">
          O mesmo snapshot que o cliente recebeu. Sem recálculo ao vivo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}
        {snapshots.length === 0 && !error ? (
          <p className="text-muted-foreground">Nenhum snapshot ainda.</p>
        ) : null}
        {snapshots.map((snapshot) => (
          <div key={snapshot.id} className="rounded-md border p-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{snapshot.periodType}</Badge>
              <Badge variant="outline">{snapshot.status}</Badge>
              <Badge variant="outline">{snapshot.headlineState}</Badge>
            </div>
            <p className="font-medium">
              {snapshot.payload?.headline?.title ?? "Relatório"}
            </p>
            <p className="text-muted-foreground">
              {snapshot.periodStart} → {snapshot.periodEnd}
              {snapshot.deliveredAt
                ? ` · enviado ${new Date(snapshot.deliveredAt).toLocaleString("pt-BR")}`
                : " · ainda não enviado"}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
