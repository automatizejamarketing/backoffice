import { describe, expect, test } from "bun:test";

import {
  ACTIVITY_POLL_OVERLAP_MS,
  activityDedupHash,
  matchActivitiesToChanges,
  toActivityEventRows,
  type ActivityEventRow,
  type EnrichableChange,
} from "@/lib/meta-tracking/activity-enrichment";
import {
  activityV25,
  FIXTURE_ACCOUNT_ID,
  FIXTURE_ADSET_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_USER_ID,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";

const DETECTED_AT = new Date("2026-08-09T08:05:00Z");

function rowsOf(...raw: Record<string, unknown>[]): ActivityEventRow[] {
  return toActivityEventRows({
    userId: FIXTURE_USER_ID,
    accountId: FIXTURE_ACCOUNT_ID,
    rows: raw,
  });
}

/** Uma ação de configuração da campanha, como o diff acabou de escrevê-la. */
function pendingChange(
  overrides: Partial<EnrichableChange> = {},
): EnrichableChange {
  return {
    changeEventId: "evt-1",
    entityLevel: "campaign",
    entityId: FIXTURE_CAMPAIGN_ID,
    changeKind: "config_change",
    detectedAt: DETECTED_AT,
    ...overrides,
  };
}

describe("activityDedupHash", () => {
  test("a mesma tupla produz o mesmo hash — é o que dedupliza a sobreposição", () => {
    const parts = {
      accountId: FIXTURE_ACCOUNT_ID,
      eventType: "update_campaign_budget",
      eventTime: new Date("2026-08-08T17:33:21Z"),
      objectId: FIXTURE_CAMPAIGN_ID,
      actorId: "10223344556677889",
    };

    expect(activityDedupHash(parts)).toBe(activityDedupHash(parts));
    expect(activityDedupHash(parts)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("qualquer um dos cinco campos muda o hash", () => {
    const base = {
      accountId: FIXTURE_ACCOUNT_ID,
      eventType: "update_campaign_budget",
      eventTime: new Date("2026-08-08T17:33:21Z"),
      objectId: FIXTURE_CAMPAIGN_ID,
      actorId: "10223344556677889",
    };
    const variants = [
      { ...base, accountId: "act_111222333444555" },
      { ...base, eventType: "update_campaign_run_status" },
      { ...base, eventTime: new Date("2026-08-08T17:33:22Z") },
      { ...base, objectId: FIXTURE_ADSET_ID },
      { ...base, actorId: "99887766554433221" },
    ];

    const hashes = new Set([
      activityDedupHash(base),
      ...variants.map(activityDedupHash),
    ]);
    expect(hashes.size).toBe(6);
  });

  test("a fronteira entre os campos é respeitada: 12+3 não colide com 1+23", () => {
    const base = {
      accountId: FIXTURE_ACCOUNT_ID,
      eventType: "update_campaign_budget",
      eventTime: new Date("2026-08-08T17:33:21Z"),
    };

    expect(activityDedupHash({ ...base, objectId: "12", actorId: "3" })).not.toBe(
      activityDedupHash({ ...base, objectId: "1", actorId: "23" }),
    );
  });

  test("ausente e vazio são a mesma coisa — a Meta manda os dois", () => {
    const base = {
      accountId: FIXTURE_ACCOUNT_ID,
      eventType: "ad_account_billing_charge",
      eventTime: new Date("2026-08-08T17:33:21Z"),
      objectId: null,
    };

    expect(activityDedupHash({ ...base, actorId: null })).toBe(
      activityDedupHash({ ...base, actorId: "" }),
    );
  });
});

describe("toActivityEventRows", () => {
  test("o evento cru vira linha com o hash de dedup e o extra_data aberto", () => {
    const [row] = rowsOf(activityV25());

    expect(row).toMatchObject({
      userId: FIXTURE_USER_ID,
      accountId: FIXTURE_ACCOUNT_ID,
      eventType: "update_campaign_budget",
      translatedEventType: "Orçamento da campanha editado",
      actorId: "10223344556677889",
      actorName: "Maria Souza",
      applicationId: "1122334455667788",
      objectId: FIXTURE_CAMPAIGN_ID,
      objectType: "CAMPAIGN",
      // `extra_data` chega como STRING de JSON; guardar assim enterraria o
      // conteúdo atrás de um cast na hora de consultar.
      extraData: { old_value: "5000", new_value: "7000" },
    });
    expect(row.eventTime.toISOString()).toBe("2026-08-08T17:33:21.000Z");
    expect(row.dedupHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("evento sem relação com ação nenhuma é guardado igual", () => {
    const rows = rowsOf(
      activityV25({
        event_type: "ad_account_billing_charge",
        object_id: undefined,
        actor_id: undefined,
        actor_name: undefined,
        object_type: "ACCOUNT",
        extra_data: undefined,
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: "ad_account_billing_charge",
      objectId: null,
      actorId: null,
      extraData: null,
    });
  });

  test("o mesmo evento repetido na resposta vira uma linha só", () => {
    // A sobreposição de 48 h existe para isso: um `ON CONFLICT DO UPDATE` com a
    // mesma chave duas vezes no mesmo comando é erro do Postgres.
    const rows = rowsOf(activityV25(), activityV25(), activityV25());

    expect(rows).toHaveLength(1);
  });

  test("o horário sem fuso é lido como UTC, não como o fuso da máquina", () => {
    // O hash depende desta leitura: se ela variasse com o servidor, o mesmo
    // evento geraria linhas diferentes a cada execução.
    const [row] = rowsOf(activityV25({ event_time: "2026-08-08 17:33:21" }));

    expect(row.eventTime.toISOString()).toBe("2026-08-08T17:33:21.000Z");
  });

  test("linha sem tipo de evento ou sem instante utilizável é descartada", () => {
    const rows = rowsOf(
      activityV25({ event_type: undefined }),
      activityV25({ event_time: "ontem de manhã" }),
      activityV25({ event_time: undefined }),
    );

    expect(rows).toEqual([]);
  });

  test("extra_data que não é JSON é guardado como texto, sem quebrar a linha", () => {
    const [row] = rowsOf(activityV25({ extra_data: "sem formato conhecido" }));

    expect(row.extraData).toBe("sem formato conhecido");
  });
});

describe("matchActivitiesToChanges", () => {
  test("match certo: a ação detectada ganha autor e o horário exato", () => {
    const activities = rowsOf(activityV25());

    const matches = matchActivitiesToChanges({
      activities,
      changes: [pendingChange()],
    });

    expect(matches).toEqual([
      {
        changeEventId: "evt-1",
        dedupHash: activities[0].dedupHash,
        actorName: "Maria Souza",
        occurredAt: new Date("2026-08-08T17:33:21Z"),
      },
    ]);
  });

  test("sem candidato: entidade diferente não casa", () => {
    const matches = matchActivitiesToChanges({
      activities: rowsOf(activityV25({ object_id: FIXTURE_ADSET_ID })),
      changes: [pendingChange()],
    });

    expect(matches).toEqual([]);
  });

  test("sem candidato: evento fora da janela do poll não casa", () => {
    const tooOld = new Date(
      DETECTED_AT.getTime() - ACTIVITY_POLL_OVERLAP_MS - 1000,
    );
    const matches = matchActivitiesToChanges({
      activities: rowsOf(activityV25({ event_time: tooOld.toISOString() })),
      changes: [pendingChange()],
    });

    expect(matches).toEqual([]);
  });

  test("sem candidato: evento posterior à detecção não explica o que já foi visto", () => {
    const afterDetection = new Date(DETECTED_AT.getTime() + 60_000);
    const matches = matchActivitiesToChanges({
      activities: rowsOf(
        activityV25({ event_time: afterDetection.toISOString() }),
      ),
      changes: [pendingChange()],
    });

    expect(matches).toEqual([]);
  });

  test("ambíguo: duas pessoas mexeram na mesma entidade, ninguém leva o crédito", () => {
    const activities = rowsOf(
      activityV25(),
      activityV25({
        event_time: "2026-08-08T19:10:00+0000",
        actor_id: "99887766554433221",
        actor_name: "João Lima",
      }),
    );

    const matches = matchActivitiesToChanges({
      activities,
      changes: [pendingChange()],
    });

    expect(matches).toEqual([]);
  });

  test("mesma pessoa duas vezes: vale a mais recente, que produziu o estado observado", () => {
    const activities = rowsOf(
      activityV25({ event_time: "2026-08-08T12:00:00+0000" }),
      activityV25({ event_time: "2026-08-08T19:10:00+0000" }),
    );

    const matches = matchActivitiesToChanges({
      activities,
      changes: [pendingChange()],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].occurredAt).toEqual(new Date("2026-08-08T19:10:00Z"));
  });

  test("pausa e edição de orçamento no mesmo dia não trocam de autor", () => {
    const activities = rowsOf(
      activityV25(),
      activityV25({
        event_type: "update_campaign_run_status",
        event_time: "2026-08-08T20:00:00+0000",
        actor_id: "99887766554433221",
        actor_name: "João Lima",
      }),
    );

    const matches = matchActivitiesToChanges({
      activities,
      changes: [
        pendingChange({ changeEventId: "evt-status", changeKind: "status_transition" }),
        pendingChange({ changeEventId: "evt-config" }),
      ],
    });

    expect(matches).toEqual([
      {
        changeEventId: "evt-status",
        dedupHash: activities[1].dedupHash,
        actorName: "João Lima",
        occurredAt: new Date("2026-08-08T20:00:00Z"),
      },
      {
        changeEventId: "evt-config",
        dedupHash: activities[0].dedupHash,
        actorName: "Maria Souza",
        occurredAt: new Date("2026-08-08T17:33:21Z"),
      },
    ]);
  });

  test("criação da entidade casa com o evento de criação, não com uma edição", () => {
    const activities = rowsOf(
      activityV25({
        event_type: "create_campaign_group",
        translated_event_type: "Campanha criada",
        event_time: "2026-08-08T09:00:00+0000",
      }),
    );

    const created = matchActivitiesToChanges({
      activities,
      changes: [pendingChange({ changeKind: "created" })],
    });
    const config = matchActivitiesToChanges({
      activities,
      changes: [pendingChange()],
    });

    expect(created).toHaveLength(1);
    expect(config).toEqual([]);
  });

  test("um evento cru explica uma ação só: não é reaproveitado pela seguinte", () => {
    const activities = rowsOf(activityV25());

    const matches = matchActivitiesToChanges({
      activities,
      // As duas ações alcançam o mesmo evento cru na janela; só a primeira leva.
      changes: [
        pendingChange({ changeEventId: "evt-hoje" }),
        pendingChange({
          changeEventId: "evt-de-madrugada",
          detectedAt: new Date("2026-08-09T02:00:00Z"),
        }),
      ],
    });

    expect(matches.map((match) => match.changeEventId)).toEqual(["evt-hoje"]);
  });

  test("arquivamento também é ciclo de vida e casa com o evento de status", () => {
    const activities = rowsOf(
      activityV25({
        event_type: "update_campaign_run_status",
        event_time: "2026-08-08T20:00:00+0000",
      }),
    );

    const matches = matchActivitiesToChanges({
      activities,
      changes: [pendingChange({ changeKind: "archived" })],
    });

    expect(matches).toHaveLength(1);
  });
});
