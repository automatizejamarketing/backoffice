import { describe, expect, test } from "bun:test";

import {
  buildActionHistory,
  mergeActionStreams,
  type ActionHistoryEvent,
} from "@/lib/meta-tracking/action-history-view";

function event(overrides: Partial<ActionHistoryEvent>): ActionHistoryEvent {
  return {
    id: "evt-1",
    entityLevel: "campaign",
    entityId: "120000000000001",
    entityName: "[AM] Vendas — Agosto",
    campaignId: null,
    adsetId: null,
    changeKind: "config_change",
    changedFields: {},
    source: "external_detected",
    actorEmail: null,
    actorNameMeta: null,
    note: null,
    occurredAt: new Date("2026-08-09T12:00:00.000Z"),
    detectedAt: new Date("2026-08-09T12:00:00.000Z"),
    legacyEditLogTable: null,
    legacyEditLogId: null,
    ...overrides,
  };
}

describe("buildActionHistory", () => {
  test("ação do backoffice mostra origem, autor e motivo", () => {
    const [item] = buildActionHistory([
      event({
        source: "backoffice_admin",
        actorEmail: "gestor@automatizeja.com",
        note: "Cliente pediu para segurar o gasto até sexta",
        changeKind: "status_transition",
        changedFields: { status: { old: "ACTIVE", new: "PAUSED" } },
      }),
    ]);

    expect(item!.sourceLabel).toBe("Backoffice");
    expect(item!.actorLabel).toBe("gestor@automatizeja.com");
    expect(item!.note).toBe("Cliente pediu para segurar o gasto até sexta");
    expect(item!.kindLabel).toBe("Mudança de status");
    expect(item!.changes).toEqual([
      { field: "status", label: "Status", from: "ACTIVE", to: "PAUSED" },
    ]);
  });

  test("ação detectada no Gerenciador não tem motivo e usa o autor do audit trail da Meta", () => {
    const [item] = buildActionHistory([
      event({
        source: "external_detected",
        actorNameMeta: "Maria Souza",
        changedFields: { name: { old: "Campanha A", new: "Campanha B" } },
      }),
    ]);

    expect(item!.sourceLabel).toBe("Gerenciador de Anúncios");
    expect(item!.actorLabel).toBe("Maria Souza");
    expect(item!.note).toBeNull();
  });

  test("orçamento vem da Meta em unidades menores e é exibido como dinheiro", () => {
    const [item] = buildActionHistory(
      [
        event({
          changedFields: {
            daily_budget: { old: "5000", new: "12050" },
          },
        }),
      ],
      { currency: "BRL" },
    );

    expect(item!.changes[0]!.label).toBe("Orçamento diário");
    expect(item!.changes[0]!.from).toContain("50,00");
    expect(item!.changes[0]!.to).toContain("120,50");
  });

  test("mudança rejeitada pela Meta aparece como não aplicada, sem virar campo do diff", () => {
    const [item] = buildActionHistory([
      event({
        source: "backoffice_admin",
        actorEmail: "gestor@automatizeja.com",
        note: "Aumento de verba aprovado",
        changedFields: {
          daily_budget: { old: "5000", new: "12050" },
          __apply_failed__: { old: null, new: "Meta recusou: subcode 1487390" },
        },
      }),
    ]);

    expect(item!.appliedToMeta).toBe(false);
    expect(item!.failureMessage).toBe("Meta recusou: subcode 1487390");
    expect(item!.changes.map((change) => change.field)).toEqual([
      "daily_budget",
    ]);
  });

  test("valor ausente vira travessão e booleano vira sim/não", () => {
    const [item] = buildActionHistory([
      event({
        changedFields: {
          end_time: { old: null, new: "2026-09-01T03:00:00+0000" },
          is_dynamic_creative: { old: false, new: true },
        },
      }),
    ]);

    const byField = new Map(item!.changes.map((c) => [c.field, c]));
    expect(byField.get("end_time")!.from).toBe("—");
    expect(byField.get("is_dynamic_creative")!.from).toBe("não");
    expect(byField.get("is_dynamic_creative")!.to).toBe("sim");
  });

  test("estrutura grande vira resumo curto em vez de despejo de JSON", () => {
    const [item] = buildActionHistory([
      event({
        changedFields: {
          targeting: {
            old: { age_min: 18, age_max: 65, geo_locations: { countries: ["BR"] } },
            new: {
              age_min: 25,
              age_max: 45,
              geo_locations: { countries: ["BR", "PT"] },
              interests: Array.from({ length: 40 }, (_, i) => ({
                id: String(i),
                name: `Interesse ${i}`,
              })),
            },
          },
        },
      }),
    ]);

    const change = item!.changes[0]!;
    expect(change.label).toBe("Segmentação");
    expect(change.to.length).toBeLessThanOrEqual(140);
    expect(change.to.endsWith("…")).toBe(true);
  });

  test("mudança só detectada pelo diff não afirma hora exata; enriquecida pela Meta, sim", () => {
    const [semEnriquecimento] = buildActionHistory([
      event({
        source: "external_detected",
        occurredAt: new Date("2026-08-09T12:00:00.000Z"),
        detectedAt: new Date("2026-08-09T12:00:00.000Z"),
      }),
    ]);
    const [enriquecida] = buildActionHistory([
      event({
        source: "external_detected",
        actorNameMeta: "Maria Souza",
        occurredAt: new Date("2026-08-08T22:14:00.000Z"),
        detectedAt: new Date("2026-08-09T12:00:00.000Z"),
      }),
    ]);

    expect(semEnriquecimento!.isExactTime).toBe(false);
    expect(enriquecida!.isExactTime).toBe(true);
  });

  test("criação sem campos alterados continua sendo notícia", () => {
    const [item] = buildActionHistory([
      event({ changeKind: "created", changedFields: {} }),
    ]);

    expect(item!.kindLabel).toBe("Criação");
    expect(item!.changes).toEqual([]);
  });

  test("as ações saem da mais recente para a mais antiga", () => {
    const items = buildActionHistory([
      event({ id: "antiga", occurredAt: new Date("2026-08-01T10:00:00Z") }),
      event({ id: "nova", occurredAt: new Date("2026-08-09T10:00:00Z") }),
      event({ id: "meio", occurredAt: new Date("2026-08-05T10:00:00Z") }),
    ]);

    expect(items.map((item) => item.id)).toEqual(["nova", "meio", "antiga"]);
  });
});

describe("mergeActionStreams", () => {
  test("junta a ação da própria campanha com as dos filhos numa linha do tempo só", () => {
    const campaignAction = event({
      id: "campanha",
      occurredAt: new Date("2026-08-05T10:00:00Z"),
    });
    const adsetAction = event({
      id: "conjunto",
      entityLevel: "adset",
      entityId: "230000000000001",
      campaignId: "120000000000001",
      occurredAt: new Date("2026-08-07T10:00:00Z"),
    });

    const merged = mergeActionStreams([[campaignAction], [adsetAction]]);

    expect(merged.map((e) => e.id)).toEqual(["conjunto", "campanha"]);
  });

  test("a mesma ação vinda de duas consultas entra uma vez só", () => {
    const action = event({ id: "evt-1" });

    expect(mergeActionStreams([[action], [action]])).toHaveLength(1);
  });

  test("o limite corta as mais antigas, nunca as mais recentes", () => {
    const merged = mergeActionStreams(
      [
        [
          event({ id: "a", occurredAt: new Date("2026-08-01T10:00:00Z") }),
          event({ id: "b", occurredAt: new Date("2026-08-02T10:00:00Z") }),
        ],
        [event({ id: "c", occurredAt: new Date("2026-08-03T10:00:00Z") })],
      ],
      2,
    );

    expect(merged.map((e) => e.id)).toEqual(["c", "b"]);
  });
});
