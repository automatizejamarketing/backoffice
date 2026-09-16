"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RetentionRow = {
  cohort: string;
  users: number;
  retained_30d: number;
  retained_60d: number;
  retained_90d: number;
};

export function ClientReportsSection() {
  const [rows, setRows] = useState<RetentionRow[]>([]);

  useEffect(() => {
    fetch("/api/client-reports/retention")
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .then((data) => setRows(data.rows ?? []))
      .catch(() => setRows([]));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Relatório de Valor</CardTitle>
        <p className="text-xs text-muted-foreground">
          Kill switch: `CLIENT_REPORTS_ENABLED` e `CLIENT_REPORTS_DISPATCH_ENABLED`.
          Allowlist: `CLIENT_REPORTS_USER_ALLOWLIST`. Thresholds de ROAS bom = 2x
          (reusa goodRoasInfo).
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">
            Sem coorte ainda — os snapshots precisam ser entregues.
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.cohort} className="rounded-md border p-3">
              <p className="font-medium">{row.cohort}</p>
              <p className="text-muted-foreground">
                {row.users} usuários · 30d {row.retained_30d} · 60d{" "}
                {row.retained_60d} · 90d {row.retained_90d}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
