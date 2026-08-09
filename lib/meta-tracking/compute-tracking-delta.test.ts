/**
 * Costura 1 — cálculo do delta de tracking (§ "Testing Decisions" da spec).
 *
 * Alimentada com fixtures derivadas de respostas reais da Graph API v25 nos
 * três níveis, a costura recebe DADOS e devolve DADOS: nenhum teste aqui sabe
 * como o resultado foi obtido, e nenhum toca banco ou rede.
 */
import { describe, expect, test } from "bun:test";

import {
  computeTrackingDelta,
  type KnownEntityState,
  type TrackingDeltaInput,
} from "@/lib/meta-tracking/compute-tracking-delta";
import {
  hashTrackedConfig,
  normalizeTrackedConfig,
} from "@/lib/meta-tracking/config-version";
import {
  adConfigV25,
  adsetConfigV25,
  campaignConfigV25,
  FIXTURE_ACCOUNT_ID,
  FIXTURE_AD_ID,
  FIXTURE_ADSET_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_MANAGED_PREFIX,
  FIXTURE_USER_ID,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";

const OBSERVED_AT = new Date("2026-08-09T08:05:00.000Z");
const YESTERDAY_VERSION_ID = "6f0b9c14-7d21-4f8a-9e3b-1c2d3e4f5a60";

/** Uma ação já registrada por escrita interna, dentro da janela de tolerância. */
const INTERNAL_EVENT_ID = "c1a7f3d2-91b4-4f0e-8a6c-5d4e3f2a1b09";
const INTERNAL_OCCURRED_AT = new Date("2026-08-08T17:41:00.000Z");

/** A versão vigente que a coleta de ontem deixou para esta config. */
function openVersionFor(
  config: Record<string, unknown>,
  overrides: Partial<KnownEntityState["currentVersion"] & object> = {},
): NonNullable<KnownEntityState["currentVersion"]> {
  return {
    id: YESTERDAY_VERSION_ID,
    versionNumber: 3,
    configHash: hashTrackedConfig(normalizeTrackedConfig(config)),
    isManaged: true,
    config,
    ...overrides,
  };
}

/** Uma conta observada agora: a listagem, o fetch profundo e o que já se sabia. */
function makeInput(args: {
  listing: TrackingDeltaInput["listing"];
  configs: TrackingDeltaInput["configs"];
  previous?: KnownEntityState[];
  internalChanges?: TrackingDeltaInput["internalChanges"];
}): TrackingDeltaInput {
  return {
    userId: FIXTURE_USER_ID,
    accountId: FIXTURE_ACCOUNT_ID,
    observedAt: OBSERVED_AT,
    managedCampaignNamePrefix: FIXTURE_MANAGED_PREFIX,
    listing: args.listing,
    configs: args.configs,
    previous: args.previous ?? [],
    internalChanges: args.internalChanges,
  };
}

/** Conta de uma campanha só, ativa e com configuração profunda coletada. */
function inputWithCampaign(args: {
  config: Record<string, unknown>;
  previous?: KnownEntityState[];
  internalChanges?: TrackingDeltaInput["internalChanges"];
}): TrackingDeltaInput {
  return makeInput({
    listing: [
      {
        entityLevel: "campaign",
        entityId: FIXTURE_CAMPAIGN_ID,
        name: args.config.name as string,
        status: args.config.status as string,
        effectiveStatus: args.config.effective_status as string,
      },
    ],
    configs: [
      {
        entityLevel: "campaign",
        entityId: FIXTURE_CAMPAIGN_ID,
        config: args.config,
      },
    ],
    previous: args.previous,
    internalChanges: args.internalChanges,
  });
}

/** Listagem crua, sem fetch profundo — o caso de quem não está entregando. */
function listingOnlyInput(
  listing: TrackingDeltaInput["listing"],
  previous: KnownEntityState[],
): TrackingDeltaInput {
  return makeInput({ listing, configs: [], previous });
}

describe("computeTrackingDelta — idempotência", () => {
  test("a mesma configuração observada de novo não produz versão nem evento", () => {
    const config = campaignConfigV25();

    const delta = computeTrackingDelta(
      inputWithCampaign({
        config,
        previous: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(config),
          },
        ],
      }),
    );

    expect(delta.versions).toEqual([]);
    expect(delta.events).toEqual([]);
    expect(delta.confirmations).toHaveLength(1);
    expect(delta.confirmations[0].versionId).toBe(YESTERDAY_VERSION_ID);
    expect(delta.confirmations[0].lastConfirmedAt).toEqual(OBSERVED_AT);
  });
});

describe("computeTrackingDelta — campos voláteis", () => {
  test("orçamento restante e fase de aprendizado mudando sozinhos não abrem versão", () => {
    const yesterday = campaignConfigV25();
    const today = campaignConfigV25({
      budget_remaining: "1275",
      updated_time: "2026-08-09T04:59:00-0300",
    });

    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: today,
        previous: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(yesterday),
          },
        ],
      }),
    );

    expect(delta.versions).toEqual([]);
    expect(delta.events).toEqual([]);
    // O valor novo do volátil ainda precisa chegar à versão vigente.
    expect(delta.confirmations[0].volatile.budgetRemaining).toBe("1275");
    expect(delta.confirmations[0].volatile.updatedTimeMeta).toEqual(
      new Date("2026-08-09T04:59:00-0300"),
    );
  });
});

describe("computeTrackingDelta — mudança real de configuração", () => {
  test("abre versão nova fechando a anterior e registra o diff campo a campo", () => {
    const yesterday = campaignConfigV25();
    const today = campaignConfigV25({
      daily_budget: "9000",
      bid_strategy: "COST_CAP",
      // Volátil junto: mudou porque a configuração mudou, mas não é o diff.
      updated_time: "2026-08-09T04:59:00-0300",
    });

    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: today,
        previous: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(yesterday),
          },
        ],
      }),
    );

    expect(delta.confirmations).toEqual([]);
    expect(delta.versions).toHaveLength(1);
    const [version] = delta.versions;
    expect(version.versionNumber).toBe(4);
    expect(version.validFrom).toEqual(OBSERVED_AT);
    expect(version.supersedesVersionId).toBe(YESTERDAY_VERSION_ID);
    expect(version.columns.dailyBudget).toBe("9000");
    expect(version.config).toEqual(today);

    expect(delta.events).toHaveLength(1);
    const [event] = delta.events;
    expect(event.changeKind).toBe("config_change");
    expect(event.source).toBe("external_detected");
    expect(event.fromConfigVersionId).toBe(YESTERDAY_VERSION_ID);
    expect(event.toVersionRef).toBe(version.ref);
    expect(event.occurredAt).toEqual(OBSERVED_AT);
    // Exatamente o que mudou, velho→novo — e nada de volátil.
    expect(event.changedFields).toEqual({
      daily_budget: { old: "5000", new: "9000" },
      bid_strategy: { old: "LOWEST_COST_WITHOUT_CAP", new: "COST_CAP" },
    });
  });
});

describe("computeTrackingDelta — transições de ciclo de vida", () => {
  test("pausar gera evento de transição e nenhuma versão", () => {
    const delta = computeTrackingDelta(
      listingOnlyInput(
        [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            name: campaignConfigV25().name as string,
            status: "PAUSED",
            effectiveStatus: "PAUSED",
          },
        ],
        [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(campaignConfigV25()),
          },
        ],
      ),
    );

    expect(delta.versions).toEqual([]);
    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].changeKind).toBe("status_transition");
    expect(delta.events[0].changedFields).toEqual({
      effective_status: { old: "ACTIVE", new: "PAUSED" },
    });
    expect(delta.events[0].toVersionRef).toBeNull();
    expect(delta.events[0].fromConfigVersionId).toBeNull();
  });

  test("cascata por pausa do pai é transição do filho, não configuração dele", () => {
    const delta = computeTrackingDelta(
      listingOnlyInput(
        [
          {
            entityLevel: "adset",
            entityId: FIXTURE_ADSET_ID,
            campaignId: FIXTURE_CAMPAIGN_ID,
            name: "Conjunto — Interesses gastronomia",
            // O interruptor do conjunto continua ligado: quem pausou foi o pai.
            status: "ACTIVE",
            effectiveStatus: "CAMPAIGN_PAUSED",
          },
        ],
        [
          {
            entityLevel: "adset",
            entityId: FIXTURE_ADSET_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(adsetConfigV25()),
          },
        ],
      ),
    );

    expect(delta.versions).toEqual([]);
    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].changeKind).toBe("status_transition");
    expect(delta.events[0].campaignId).toBe(FIXTURE_CAMPAIGN_ID);
    expect(delta.events[0].changedFields).toEqual({
      effective_status: { old: "ACTIVE", new: "CAMPAIGN_PAUSED" },
    });
  });

  test("arquivar e deletar têm tipo de evento próprio", () => {
    const previous: KnownEntityState[] = [
      {
        entityLevel: "campaign",
        entityId: FIXTURE_CAMPAIGN_ID,
        lastEffectiveStatus: "PAUSED",
        currentVersion: openVersionFor(campaignConfigV25()),
      },
    ];

    const archived = computeTrackingDelta(
      listingOnlyInput(
        [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            status: "ARCHIVED",
            effectiveStatus: "ARCHIVED",
          },
        ],
        previous,
      ),
    );
    expect(archived.events[0].changeKind).toBe("archived");

    const deleted = computeTrackingDelta(
      listingOnlyInput(
        [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            status: "DELETED",
            effectiveStatus: "DELETED",
          },
        ],
        previous,
      ),
    );
    expect(deleted.events[0].changeKind).toBe("deleted_detected");
  });

  test("estado efetivo igual ao do dia anterior não gera nada", () => {
    const delta = computeTrackingDelta(
      listingOnlyInput(
        [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            status: "PAUSED",
            effectiveStatus: "PAUSED",
          },
        ],
        [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            lastEffectiveStatus: "PAUSED",
          },
        ],
      ),
    );

    expect(delta).toEqual({
      versions: [],
      events: [],
      confirmations: [],
      versionLinks: [],
    });
  });
});

describe("computeTrackingDelta — descoberta e reativação", () => {
  test("campanha nunca vista entra com evento de criação e a primeira versão", () => {
    const config = campaignConfigV25();

    const delta = computeTrackingDelta(inputWithCampaign({ config }));

    expect(delta.versions).toHaveLength(1);
    expect(delta.versions[0].versionNumber).toBe(1);
    expect(delta.versions[0].supersedesVersionId).toBeNull();
    expect(delta.versions[0].isManaged).toBe(true);

    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].changeKind).toBe("created");
    expect(delta.events[0].toVersionRef).toBe(delta.versions[0].ref);
    // O estado com que apareceu fica no stream: é dele que a próxima execução
    // reconstrói o último status conhecido de quem não tem versão.
    expect(delta.events[0].changedFields).toEqual({
      effective_status: { old: null, new: "ACTIVE" },
    });
  });

  test("entidade descoberta pausada é criação sem versão — sem tracking profundo", () => {
    const delta = computeTrackingDelta(
      listingOnlyInput(
        [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            name: "Campanha do cliente",
            status: "PAUSED",
            effectiveStatus: "PAUSED",
          },
        ],
        [],
      ),
    );

    expect(delta.versions).toEqual([]);
    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].changeKind).toBe("created");
    expect(delta.events[0].changedFields).toEqual({
      effective_status: { old: null, new: "PAUSED" },
    });
  });

  test("entidade reativada volta a produzir versão, com a transição registrada", () => {
    const config = campaignConfigV25();

    const delta = computeTrackingDelta(
      makeInput({
        listing: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            name: config.name as string,
            status: "ACTIVE",
            effectiveStatus: "ACTIVE",
          },
        ],
        configs: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            config,
          },
        ],
        previous: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            // Foi descoberta pausada: existe no stream, nunca teve versão.
            lastEffectiveStatus: "PAUSED",
            currentVersion: null,
          },
        ],
      }),
    );

    expect(delta.versions).toHaveLength(1);
    expect(delta.versions[0].versionNumber).toBe(1);
    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].changeKind).toBe("status_transition");
    expect(delta.events[0].changedFields).toEqual({
      effective_status: { old: "PAUSED", new: "ACTIVE" },
    });
  });
});

describe("computeTrackingDelta — marca de Campanha Gerenciada por versão", () => {
  test("renomear tirando o prefixo muda a flag só da versão nova", () => {
    const yesterday = campaignConfigV25();
    const today = campaignConfigV25({ name: "Campanha da loja" });

    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: today,
        previous: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(yesterday, { isManaged: true }),
          },
        ],
      }),
    );

    expect(delta.versions).toHaveLength(1);
    expect(delta.versions[0].isManaged).toBe(false);
    expect(delta.versions[0].versionNumber).toBe(4);
    // A versão anterior só é FECHADA; nada no delta reescreve a marca dela.
    expect(delta.versions[0].supersedesVersionId).toBe(YESTERDAY_VERSION_ID);
    expect(delta.confirmations).toEqual([]);
    expect(delta.events[0].changedFields).toEqual({
      name: {
        old: "[AM][VENDAS][FS][2026-06-18-19-22-53]",
        new: "Campanha da loja",
      },
    });
  });

  test("renomear colocando o prefixo passa a marcar como gerenciada", () => {
    const yesterday = campaignConfigV25({ name: "Campanha da loja" });
    const today = campaignConfigV25({ name: "[AM][VENDAS] retomada" });

    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: today,
        previous: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(yesterday, { isManaged: false }),
          },
        ],
      }),
    );

    expect(delta.versions[0].isManaged).toBe(true);
  });
});

describe("computeTrackingDelta — os três níveis numa observação só", () => {
  const campaign = campaignConfigV25();
  const adset = adsetConfigV25();
  const ad = adConfigV25();

  const fullAccount = makeInput({
    listing: [
      {
        entityLevel: "campaign",
        entityId: FIXTURE_CAMPAIGN_ID,
        name: campaign.name as string,
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
      },
      {
        entityLevel: "adset",
        entityId: FIXTURE_ADSET_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        name: adset.name as string,
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
      },
      {
        entityLevel: "ad",
        entityId: FIXTURE_AD_ID,
        campaignId: FIXTURE_CAMPAIGN_ID,
        adsetId: FIXTURE_ADSET_ID,
        name: ad.name as string,
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
      },
    ],
    configs: [
      {
        entityLevel: "campaign",
        entityId: FIXTURE_CAMPAIGN_ID,
        config: campaign,
      },
      { entityLevel: "adset", entityId: FIXTURE_ADSET_ID, config: adset },
      { entityLevel: "ad", entityId: FIXTURE_AD_ID, config: ad },
    ],
  });

  test("versiona campanha, conjunto e anúncio com a hierarquia desnormalizada", () => {
    const delta = computeTrackingDelta(fullAccount);

    expect(delta.versions.map((version) => version.entityLevel)).toEqual([
      "campaign",
      "adset",
      "ad",
    ]);
    expect(delta.events.map((event) => event.changeKind)).toEqual([
      "created",
      "created",
      "created",
    ]);

    const [, adsetVersion, adVersion] = delta.versions;
    expect(adsetVersion.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
    expect(adsetVersion.columns.optimizationGoal).toBe("OFFSITE_CONVERSIONS");
    expect(adVersion.campaignId).toBe(FIXTURE_CAMPAIGN_ID);
    expect(adVersion.adsetId).toBe(FIXTURE_ADSET_ID);
    expect(adVersion.columns.creativeId).toBe("120250000000000401");
  });

  test("conjunto e anúncio de Campanha Gerenciada herdam a marca do pai", () => {
    const delta = computeTrackingDelta(fullAccount);

    // Nem o conjunto nem o anúncio carregam o prefixo no próprio nome.
    expect(delta.versions.map((version) => version.isManaged)).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("sob campanha do cliente, nenhum nível é marcado como gerenciado", () => {
    const clientCampaign = campaignConfigV25({ name: "Campanha da loja" });
    const delta = computeTrackingDelta(
      makeInput({
        listing: fullAccount.listing.map((entity) =>
          entity.entityLevel === "campaign"
            ? { ...entity, name: "Campanha da loja" }
            : entity,
        ),
        configs: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            config: clientCampaign,
          },
          { entityLevel: "adset", entityId: FIXTURE_ADSET_ID, config: adset },
          { entityLevel: "ad", entityId: FIXTURE_AD_ID, config: ad },
        ],
      }),
    );

    expect(delta.versions.map((version) => version.isManaged)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("computeTrackingDelta — versão inicial sem listagem (caminho do backfill)", () => {
  test("configuração sem listagem vira versão sem inventar evento de criação", () => {
    const delta = computeTrackingDelta(
      makeInput({
        listing: [],
        configs: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            // O backfill captura até quem está pausado — só neste momento.
            config: campaignConfigV25({
              status: "PAUSED",
              effective_status: "PAUSED",
            }),
          },
        ],
      }),
    );

    expect(delta.versions).toHaveLength(1);
    expect(delta.versions[0].versionNumber).toBe(1);
    expect(delta.versions[0].columns.configuredStatus).toBe("PAUSED");
    expect(delta.versions[0].volatile.effectiveStatus).toBe("PAUSED");
    // Nada de `created`: a entidade não nasceu hoje, só entrou no tracking hoje.
    expect(delta.events).toEqual([]);
  });
});

describe("computeTrackingDelta — mudança já registrada por escrita interna", () => {
  const yesterday = campaignConfigV25();
  const today = campaignConfigV25({ daily_budget: "9000" });
  const previous: KnownEntityState[] = [
    {
      entityLevel: "campaign",
      entityId: FIXTURE_CAMPAIGN_ID,
      lastEffectiveStatus: "ACTIVE",
      currentVersion: openVersionFor(yesterday),
    },
  ];

  const pausedListing: TrackingDeltaInput["listing"] = [
    {
      entityLevel: "campaign",
      entityId: FIXTURE_CAMPAIGN_ID,
      name: yesterday.name as string,
      status: "PAUSED",
      effectiveStatus: "PAUSED",
    },
  ];

  test("não duplica o evento: só liga a versão nova ao evento que já existe", () => {
    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: today,
        previous,
        internalChanges: [
          {
            changeEventId: INTERNAL_EVENT_ID,
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            changeKind: "config_change",
            changedFields: { daily_budget: { old: "5000", new: "9000" } },
            occurredAt: INTERNAL_OCCURRED_AT,
          },
        ],
      }),
    );

    // A versão nasce — a configuração mudou de fato.
    expect(delta.versions).toHaveLength(1);
    expect(delta.versions[0].columns.dailyBudget).toBe("9000");
    // O evento NÃO nasce de novo.
    expect(delta.events).toEqual([]);
    // E a versão nova passa a ser o destino do evento que já está no stream.
    expect(delta.versionLinks).toEqual([
      { changeEventId: INTERNAL_EVENT_ID, toVersionRef: delta.versions[0].ref },
    ]);
  });

  test("a parte que o cliente mexeu por fora continua virando evento", () => {
    const alsoRenamed = campaignConfigV25({
      daily_budget: "9000",
      name: "[AM] Renomeada no Gerenciador",
    });

    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: alsoRenamed,
        previous,
        internalChanges: [
          {
            changeEventId: INTERNAL_EVENT_ID,
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            changeKind: "config_change",
            changedFields: { daily_budget: { old: "5000", new: "9000" } },
            occurredAt: INTERNAL_OCCURRED_AT,
          },
        ],
      }),
    );

    expect(delta.events).toHaveLength(1);
    expect(Object.keys(delta.events[0].changedFields)).toEqual(["name"]);
    expect(delta.events[0].source).toBe("external_detected");
    expect(delta.versionLinks).toHaveLength(1);
  });

  test("mesmo campo com valor diferente do registrado continua sendo ação externa", () => {
    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: today,
        previous,
        internalChanges: [
          {
            changeEventId: INTERNAL_EVENT_ID,
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            changeKind: "config_change",
            // O gestor subiu para 7000; a conta está em 9000 — alguém mexeu
            // depois, por fora. O evento externo tem de existir.
            changedFields: { daily_budget: { old: "5000", new: "7000" } },
            occurredAt: INTERNAL_OCCURRED_AT,
          },
        ],
      }),
    );

    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].changedFields.daily_budget).toEqual({
      old: "5000",
      new: "9000",
    });
    expect(delta.versionLinks).toEqual([]);
  });

  test("escrita interna fora da janela de tolerância não deduplica nada", () => {
    const delta = computeTrackingDelta(
      inputWithCampaign({
        config: today,
        previous,
        internalChanges: [
          {
            changeEventId: INTERNAL_EVENT_ID,
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            changeKind: "config_change",
            changedFields: { daily_budget: { old: "5000", new: "9000" } },
            // Três dias atrás: a coleta daquele dia já ligou esse evento à
            // versão da época; a mudança de hoje é outra coisa.
            occurredAt: new Date("2026-08-06T08:05:00.000Z"),
          },
        ],
      }),
    );

    expect(delta.events).toHaveLength(1);
    expect(delta.versionLinks).toEqual([]);
  });

  test("uma escrita interna explica uma entidade só — a irmã continua externa", () => {
    const changedAdset = adsetConfigV25({ daily_budget: "9000" });
    const delta = computeTrackingDelta(
      makeInput({
        listing: [],
        configs: [
          {
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            config: today,
          },
          {
            entityLevel: "adset",
            entityId: FIXTURE_ADSET_ID,
            config: changedAdset,
          },
        ],
        previous: [
          ...previous,
          {
            entityLevel: "adset",
            entityId: FIXTURE_ADSET_ID,
            lastEffectiveStatus: "ACTIVE",
            currentVersion: openVersionFor(adsetConfigV25()),
          },
        ],
        internalChanges: [
          {
            changeEventId: INTERNAL_EVENT_ID,
            entityLevel: "campaign",
            entityId: FIXTURE_CAMPAIGN_ID,
            changeKind: "config_change",
            changedFields: { daily_budget: { old: "5000", new: "9000" } },
            occurredAt: INTERNAL_OCCURRED_AT,
          },
        ],
      }),
    );

    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].entityLevel).toBe("adset");
    expect(delta.versionLinks).toHaveLength(1);
  });

  test("pausa feita pelo backoffice não vira transição detectada no dia seguinte", () => {
    const detected = computeTrackingDelta(
      listingOnlyInput(pausedListing, previous),
    );
    expect(detected.events).toHaveLength(1);

    const deduped = computeTrackingDelta({
      ...listingOnlyInput(pausedListing, previous),
      internalChanges: [
        {
          changeEventId: INTERNAL_EVENT_ID,
          entityLevel: "campaign",
          entityId: FIXTURE_CAMPAIGN_ID,
          changeKind: "status_transition",
          // A rota registra o status CONFIGURADO; o coletor vê o EFETIVO. São
          // nomes diferentes para o mesmo fato quando quem pausou foi a pessoa.
          changedFields: { status: { old: "ACTIVE", new: "PAUSED" } },
          occurredAt: INTERNAL_OCCURRED_AT,
        },
      ],
    });

    expect(deduped.events).toEqual([]);
    expect(deduped.versionLinks).toEqual([]);
  });

  test("um evento interno explica uma mudança só, não duas entidades iguais", () => {
    const changedAdset = adsetConfigV25({ daily_budget: "9000" });
    const otherAdsetId = "120250000000000202";
    const delta = computeTrackingDelta(
      makeInput({
        listing: [],
        configs: [
          {
            entityLevel: "adset",
            entityId: FIXTURE_ADSET_ID,
            config: changedAdset,
          },
          {
            entityLevel: "adset",
            entityId: otherAdsetId,
            config: changedAdset,
          },
        ],
        previous: [
          {
            entityLevel: "adset",
            entityId: FIXTURE_ADSET_ID,
            currentVersion: openVersionFor(adsetConfigV25()),
          },
          {
            entityLevel: "adset",
            entityId: otherAdsetId,
            currentVersion: openVersionFor(adsetConfigV25()),
          },
        ],
        internalChanges: [
          {
            changeEventId: INTERNAL_EVENT_ID,
            entityLevel: "adset",
            entityId: FIXTURE_ADSET_ID,
            changeKind: "config_change",
            changedFields: { daily_budget: { old: "5000", new: "9000" } },
            occurredAt: INTERNAL_OCCURRED_AT,
          },
        ],
      }),
    );

    // Só o conjunto nomeado pelo evento interno é deduplicado.
    expect(delta.events).toHaveLength(1);
    expect(delta.events[0].entityId).toBe(otherAdsetId);
  });
});
