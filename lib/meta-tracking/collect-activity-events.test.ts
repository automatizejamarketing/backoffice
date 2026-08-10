import { describe, expect, test } from "bun:test";

import {
  collectActivityEvents,
  type ActivityCollectionPorts,
  type ActivityLink,
  type StoredActivityEvent,
} from "@/lib/meta-tracking/collect-activity-events";
import {
  ACTIVITY_POLL_OVERLAP_MS,
  type ActivityEventRow,
  type EnrichableChange,
  type RawActivity,
} from "@/lib/meta-tracking/activity-enrichment";
import { UNKNOWN_QUOTA_USAGE } from "@/lib/meta-tracking/quota-usage";
import {
  activityV25,
  FIXTURE_ACCOUNT_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_USER_ID,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";

const NOW = new Date("2026-08-09T08:05:00Z");

const ARGS = {
  userId: FIXTURE_USER_ID,
  accountId: FIXTURE_ACCOUNT_ID,
  credentials: { accessToken: "token-de-teste" },
  now: NOW,
};

/** A ação que o diff acabou de escrever, ainda sem autor. */
function pendingChange(
  overrides: Partial<EnrichableChange> = {},
): EnrichableChange {
  return {
    changeEventId: "evt-1",
    entityLevel: "campaign",
    entityId: FIXTURE_CAMPAIGN_ID,
    changeKind: "config_change",
    detectedAt: NOW,
    ...overrides,
  };
}

type Recorded = {
  polls: Array<{ since: Date; until: Date }>;
  /** O "banco" de eventos crus, chaveado pelo hash de dedup. */
  store: Map<string, ActivityEventRow & { id: string; matchedChangeEventId: string | null }>;
  links: ActivityLink[][];
};

function makePorts(
  options: {
    activities?: RawActivity[];
    changes?: EnrichableChange[];
    overrides?: Partial<ActivityCollectionPorts>;
  } = {},
): { ports: ActivityCollectionPorts; recorded: Recorded } {
  const recorded: Recorded = { polls: [], store: new Map(), links: [] };
  let nextId = 1;

  const ports: ActivityCollectionPorts = {
    fetchActivities: async ({ since, until }) => {
      recorded.polls.push({ since, until });
      return {
        rows: options.activities ?? [activityV25()],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      };
    },
    // O upsert real é `ON CONFLICT (dedup_hash) DO UPDATE`: a linha já gravada
    // volta com o MESMO uuid, e é isso que a sobreposição do poll exercita.
    upsertActivityEvents: async (rows) => {
      const stored: StoredActivityEvent[] = [];
      for (const row of rows) {
        const existing = recorded.store.get(row.dedupHash);
        const id = existing?.id ?? `activity-${nextId++}`;
        const matchedChangeEventId = existing?.matchedChangeEventId ?? null;
        recorded.store.set(row.dedupHash, { ...row, id, matchedChangeEventId });
        stored.push({ id, dedupHash: row.dedupHash, matchedChangeEventId });
      }
      return stored;
    },
    loadEnrichableChanges: async () => options.changes ?? [pendingChange()],
    linkActivityMatches: async (links) => {
      recorded.links.push([...links]);
      for (const link of links) {
        for (const [hash, event] of recorded.store) {
          if (event.id !== link.activityEventId) continue;
          recorded.store.set(hash, {
            ...event,
            matchedChangeEventId: link.changeEventId,
          });
        }
      }
      return links.length;
    },
    ...options.overrides,
  };

  return { ports, recorded };
}

describe("collectActivityEvents", () => {
  test("o poll pede a janela de sobreposição de 48 h", async () => {
    const { ports, recorded } = makePorts();

    await collectActivityEvents(ports, ARGS);

    expect(recorded.polls).toEqual([
      {
        since: new Date(NOW.getTime() - ACTIVITY_POLL_OVERLAP_MS),
        until: NOW,
      },
    ]);
  });

  test("a mudança feita no Gerenciador ganha autor e horário exato nos dois lados", async () => {
    const { ports, recorded } = makePorts();

    const result = await collectActivityEvents(ports, ARGS);

    const [links] = recorded.links;
    expect(links).toEqual([
      {
        changeEventId: "evt-1",
        activityEventId: "activity-1",
        actorName: "Maria Souza",
        occurredAt: new Date("2026-08-08T17:33:21Z"),
      },
    ]);
    // O outro lado da ponte: o evento cru aponta de volta para a ação.
    expect([...recorded.store.values()][0].matchedChangeEventId).toBe("evt-1");
    expect(result).toMatchObject({ eventsUpserted: 1, eventsMatched: 1 });
  });

  test("dois polls consecutivos não duplicam o evento da sobreposição", async () => {
    const { ports, recorded } = makePorts({
      activities: [activityV25()],
      changes: [],
    });

    await collectActivityEvents(ports, ARGS);
    await collectActivityEvents(ports, {
      ...ARGS,
      now: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    });

    expect(recorded.store.size).toBe(1);
    expect([...recorded.store.values()][0].id).toBe("activity-1");
  });

  test("evento já usado não explica uma segunda ação no dia seguinte", async () => {
    // A sobreposição devolve o mesmo evento amanhã; se ele pudesse explicar
    // outra ação, dois fatos distintos teriam a mesma causa declarada.
    const { ports, recorded } = makePorts();

    await collectActivityEvents(ports, ARGS);
    const segunda = await collectActivityEvents(ports, {
      ...ARGS,
      now: new Date(NOW.getTime() + 12 * 60 * 60 * 1000),
    });

    expect(recorded.links).toHaveLength(1);
    expect(segunda.eventsMatched).toBe(0);
    expect([...recorded.store.values()][0].matchedChangeEventId).toBe("evt-1");
  });

  test("evento sem match fica gravado cru e não-ligado", async () => {
    const { ports, recorded } = makePorts({
      // Cobrança da conta: matéria-prima futura, sem ação correspondente.
      activities: [
        activityV25({
          event_type: "ad_account_billing_charge",
          object_id: undefined,
          object_type: "ACCOUNT",
        }),
      ],
    });

    const result = await collectActivityEvents(ports, ARGS);

    expect(recorded.store.size).toBe(1);
    expect([...recorded.store.values()][0]).toMatchObject({
      eventType: "ad_account_billing_charge",
      matchedChangeEventId: null,
    });
    expect(recorded.links).toEqual([]);
    expect(result).toMatchObject({ eventsUpserted: 1, eventsMatched: 0 });
  });

  test("ação ambígua não é enriquecida, mas os eventos crus ficam guardados", async () => {
    const { ports, recorded } = makePorts({
      activities: [
        activityV25(),
        activityV25({
          event_time: "2026-08-08T19:10:00+0000",
          actor_id: "99887766554433221",
          actor_name: "João Lima",
        }),
      ],
    });

    const result = await collectActivityEvents(ports, ARGS);

    expect(recorded.store.size).toBe(2);
    expect(recorded.links).toEqual([]);
    expect(result).toMatchObject({ eventsUpserted: 2, eventsMatched: 0 });
  });

  test("conta sem atividade nenhuma não consulta ações pendentes nem grava", async () => {
    let askedForChanges = false;
    const { ports, recorded } = makePorts({
      activities: [],
      overrides: {
        loadEnrichableChanges: async () => {
          askedForChanges = true;
          return [];
        },
      },
    });

    const result = await collectActivityEvents(ports, ARGS);

    expect(askedForChanges).toBe(false);
    expect(recorded.store.size).toBe(0);
    expect(result).toMatchObject({
      eventsUpserted: 0,
      eventsMatched: 0,
      apiCalls: 1,
    });
  });

  test("sem ação pendente, os eventos crus são gravados assim mesmo", async () => {
    const { ports, recorded } = makePorts({ changes: [] });

    const result = await collectActivityEvents(ports, ARGS);

    expect(recorded.store.size).toBe(1);
    expect(recorded.links).toEqual([]);
    expect(result.eventsUpserted).toBe(1);
  });

  test("a cota gasta pelo poll volta para o orquestrador", async () => {
    const { ports } = makePorts({
      overrides: {
        fetchActivities: async () => ({
          rows: [],
          usage: { utilizationPercent: 64, estimatedRegainMs: null },
          apiCalls: 2,
        }),
      },
    });

    const result = await collectActivityEvents(ports, ARGS);

    expect(result.usage.utilizationPercent).toBe(64);
    expect(result.apiCalls).toBe(2);
  });
});
