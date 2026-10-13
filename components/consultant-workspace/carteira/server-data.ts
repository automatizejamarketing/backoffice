import "server-only";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { getWorkspaceClients } from "@/lib/consultant-workspace/data";
import { getJourneyExtras } from "@/lib/consultant-workspace/journey-data";
import type { PerfTotals } from "@/lib/consultant-workspace/types";
import { getTouchedAlertUsers, readStateFor } from "@/components/consultant-workspace/common/server-data";
import { encodeAlerts, type CarteiraData, type WireClient } from "./types";

/**
 * Leitura da Fila/Mesa: UMA ida ao banco por período. Filtro, ordenação,
 * busca e a troca Fila ↔ Mesa acontecem no navegador. Só SELECT; nada da
 * Graph API.
 */

const r2 = (value: number) => Math.round(value * 100) / 100;

function roundTotals(totals: PerfTotals): PerfTotals {
  return {
    spend: r2(totals.spend),
    impressions: totals.impressions,
    clicks: totals.clicks,
    linkClicks: totals.linkClicks,
    results: totals.results,
    purchases: totals.purchases,
    purchaseValue: r2(totals.purchaseValue),
    leads: totals.leads,
    conversations: totals.conversations,
  };
}

function clip(text: string | null | undefined, max: number) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function getCarteiraData(actor: BackofficeActor, days: number): Promise<CarteiraData> {
  const { range, clients, alerts } = await getWorkspaceClients(actor, { days });
  const userIds = clients.map((client) => client.userId);
  const [extras, store] = await Promise.all([getJourneyExtras(userIds), readStateFor(actor)]);
  const touchedAlertUser = await getTouchedAlertUsers(
    store,
    new Set(alerts.map((alert) => alert.id)),
    new Set(userIds),
  );

  const wireClients: WireClient[] = clients.map((client) => {
    const { alerts: _summary, perf, meta, ...rest } = client;
    void _summary;
    return {
      ...rest,
      meta: { ...meta, detail: meta.detail ? clip(meta.detail, 200) : null },
      perf: {
        current: roundTotals(perf.current),
        previous: roundTotals(perf.previous),
        kpiKind: perf.kpi.kind,
        monthToDateSpend: r2(perf.monthToDateSpend),
        activeCampaigns: perf.activeCampaigns,
        spendByDay: perf.series.map((point) => r2(point.spend)),
        resultsByDay: perf.series.map((point) => point.results),
      },
    };
  });

  return {
    range,
    clients: wireClients,
    alerts: encodeAlerts(alerts, clip),
    extras,
    touchedAlertUser,
    store,
  };
}
