"use client";

import { useMemo } from "react";
import { computeJourney, type ClientJourney, type JourneyExtras } from "@/lib/consultant-workspace/journey";
import { goalStatus } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceClient, WorkspaceState } from "@/lib/consultant-workspace/types";
import { fillAlert, isAlertLive, type SlimAlert } from "./lib";

export type JourneyRow = {
  client: WorkspaceClient;
  journey: ClientJourney;
  alerts: SlimAlert[];
};

/** Etapa, bloqueio e tags de cada cliente — depende do estado (passagens e tags). */
export function useJourneyRows(
  clients: WorkspaceClient[],
  alerts: SlimAlert[],
  extras: Record<string, JourneyExtras>,
  store: WorkspaceState,
  now: number,
): JourneyRow[] {
  return useMemo(() => {
    const byUser = new Map<string, SlimAlert[]>();
    for (const alert of alerts) {
      if (!isAlertLive(alert, store, now)) continue;
      const list = byUser.get(alert.userId) ?? [];
      list.push(alert);
      byUser.set(alert.userId, list);
    }
    return clients.map((client) => {
      const clientAlerts = byUser.get(client.userId) ?? [];
      const goal = goalStatus(client.perf.kpi, store.goals[client.userId]).status;
      return {
        client,
        alerts: clientAlerts,
        journey: computeJourney(client, extras[client.userId], store, clientAlerts.map(fillAlert), goal, now),
      };
    });
  }, [clients, alerts, extras, store, now]);
}
