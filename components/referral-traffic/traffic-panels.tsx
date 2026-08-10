"use client";

// As listas do painel de tráfego: uma linha por origem, com a barra
// proporcional atrás do rótulo — a leitura é a do print de referência
// (Vercel Analytics): o olho compara comprimentos antes de ler números.
//
// Dois modos de número, escolhidos por painel:
//   * `count`  — visitantes únicos absolutos (fontes, referrers, páginas, UTM);
//   * `share`  — fatia percentual (dispositivos, navegadores, SO), porque
//     "86% desktop" informa; "412 desktop" obriga a somar de cabeça.

import { ReferralSourceIcon } from "./source-icon";
import {
  sourceForReferrerHost,
  type ReferralTrafficCount,
} from "@/lib/referral/traffic";

export function formatInt(value: number): string {
  return value.toLocaleString("pt-BR");
}

function formatShare(value: number, total: number): string {
  if (total <= 0) return "0%";
  const share = (value / total) * 100;
  if (share > 0 && share < 0.5) return "<0,5%";
  return `${Math.round(share)}%`;
}

type IconKind = "source" | "referrer" | "none";

function rowIcon(kind: IconKind, row: ReferralTrafficCount) {
  if (kind === "source") {
    return <ReferralSourceIcon sourceKey={row.key} className="size-4" />;
  }
  if (kind === "referrer") {
    const source = sourceForReferrerHost(row.label);
    return (
      <ReferralSourceIcon
        sourceKey={source ?? "referrer-host"}
        className="size-4"
      />
    );
  }
  return null;
}

export function TrafficList({
  rows,
  icon = "none",
  display = "count",
  emptyText,
}: {
  rows: ReferralTrafficCount[];
  icon?: IconKind;
  display?: "count" | "share";
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  // A barra é relativa à MAIOR linha do painel, não ao total: é assim que a
  // primeira linha sempre preenche e as demais viram comparação direta.
  const max = Math.max(...rows.map((row) => row.visitors), 1);
  const total = rows.reduce((sum, row) => sum + row.visitors, 0);

  return (
    <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
      {rows.map((row) => (
        <div
          key={row.key}
          className="relative overflow-hidden rounded-md"
          title={`${formatInt(row.clicks)} cliques · ${formatInt(row.visitors)} visitantes · ${formatInt(row.signups)} cadastros`}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-md bg-muted"
            style={{ width: `${Math.max((row.visitors / max) * 100, 2)}%` }}
          />
          <div className="relative flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {rowIcon(icon, row)}
              <span className="truncate text-sm">{row.label}</span>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-sm font-medium tabular-nums">
                {display === "share"
                  ? formatShare(row.visitors, total)
                  : formatInt(row.visitors)}
              </span>
              {display === "count" && row.signups > 0 && (
                <p className="text-[11px] leading-tight text-muted-foreground tabular-nums">
                  {formatInt(row.signups)}{" "}
                  {row.signups === 1 ? "cadastro" : "cadastros"}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
