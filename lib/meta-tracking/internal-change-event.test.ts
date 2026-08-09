import { describe, expect, test } from "bun:test";

import {
  adsetBudgetFieldChanges,
  APPLY_FAILED_FIELD,
  buildInternalChangeEvent,
  campaignBudgetFieldChanges,
  isAppliedToMeta,
  validateChangeNote,
  type InternalChangeInput,
} from "@/lib/meta-tracking/internal-change-event";

const OCCURRED_AT = new Date("2026-08-09T14:32:11.000Z");

function adminBudgetChange(
  overrides: Partial<InternalChangeInput> = {},
): InternalChangeInput {
  return {
    source: "backoffice_admin",
    userId: "8a1c0f4e-0000-4000-8000-000000000001",
    accountId: "act_998877665544332",
    entityLevel: "campaign",
    entityId: "120210000000000001",
    entityName: "[AM] Vendas — Loja Centro",
    campaignId: "120210000000000001",
    changeKind: "config_change",
    changes: [{ field: "daily_budget", old: "5000", new: "9000" }],
    actorEmail: "gestor@automatize.com",
    note: "  Subindo verba do fim de semana  ",
    occurredAt: OCCURRED_AT,
    appliedToMeta: true,
    ...overrides,
  };
}

describe("validateChangeNote — o motivo obrigatório do backoffice", () => {
  test("rejeita a mutação do backoffice sem motivo, antes de qualquer chamada à Meta", () => {
    for (const note of [undefined, null, "", "   ", "\n\t"]) {
      const result = validateChangeNote("backoffice_admin", note);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issue.code).toBe("missing_change_note");
        expect(result.issue.reason.length).toBeGreaterThan(0);
        expect(result.issue.suggestion.length).toBeGreaterThan(0);
      }
    }
  });

  test("aceita o motivo do backoffice e devolve sem espaço sobrando", () => {
    const result = validateChangeNote("backoffice_admin", "  Corte de verba  ");
    expect(result).toEqual({ ok: true, note: "Corte de verba" });
  });

  test("edição do cliente não exige motivo — ausente vira nulo", () => {
    expect(validateChangeNote("frontend_user", undefined)).toEqual({
      ok: true,
      note: null,
    });
    expect(validateChangeNote("frontend_user", "   ")).toEqual({
      ok: true,
      note: null,
    });
  });
});

describe("buildInternalChangeEvent — autoria, horário e diff", () => {
  test("grava autor, horário exato, diff e origem de administrador", () => {
    const result = buildInternalChangeEvent(adminBudgetChange());

    expect(result.ok).toBe(true);
    if (!result.ok || !result.event) throw new Error("evento esperado");

    expect(result.event.source).toBe("backoffice_admin");
    expect(result.event.actorEmail).toBe("gestor@automatize.com");
    expect(result.event.note).toBe("Subindo verba do fim de semana");
    expect(result.event.occurredAt).toEqual(OCCURRED_AT);
    expect(result.event.detectedAt).toEqual(OCCURRED_AT);
    expect(result.event.changeKind).toBe("config_change");
    expect(result.event.changedFields).toEqual({
      daily_budget: { old: "5000", new: "9000" },
    });
  });

  test("sem motivo, o backoffice não produz evento nenhum", () => {
    const result = buildInternalChangeEvent(adminBudgetChange({ note: " " }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("rejeição esperada");
    expect(result.issue.code).toBe("missing_change_note");
  });

  test("edição do cliente grava origem de usuário sem motivo", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        source: "frontend_user",
        note: undefined,
        actorEmail: "cliente@exemplo.com",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.source).toBe("frontend_user");
    expect(result.event.note).toBeNull();
    expect(result.event.actorEmail).toBe("cliente@exemplo.com");
  });

  test("campo que não mudou de fato fica fora do diff", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        changes: [
          { field: "daily_budget", old: "5000", new: "9000" },
          { field: "lifetime_budget", old: null, new: null },
          // A Meta devolve dinheiro como string; a rota calcula em número.
          { field: "bid_amount", old: "300", new: 300 },
        ],
      }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(Object.keys(result.event.changedFields)).toEqual(["daily_budget"]);
  });

  test("ausente de um dos lados vira nulo — jsonb não guarda undefined", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        changes: [{ field: "end_time", old: undefined, new: "2026-09-01T03:00:00Z" }],
      }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.changedFields.end_time).toEqual({
      old: null,
      new: "2026-09-01T03:00:00Z",
    });
  });

  test("mudança de configuração sem diff nenhum não vira evento", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        changes: [{ field: "daily_budget", old: "5000", new: "5000" }],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("resultado ok esperado");
    expect(result.event).toBeNull();
  });

  test("criação nasce no stream mesmo sem diff — é a entidade que é nova", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({ changeKind: "created", changes: [] }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.changeKind).toBe("created");
    expect(result.event.changedFields).toEqual({});
  });

  test("transição de status carrega o campo de status no diff", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        changeKind: "status_transition",
        changes: [{ field: "status", old: "ACTIVE", new: "PAUSED" }],
        note: "Cliente pediu para pausar até segunda",
      }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.changeKind).toBe("status_transition");
    expect(result.event.changedFields).toEqual({
      status: { old: "ACTIVE", new: "PAUSED" },
    });
  });
});

describe("buildInternalChangeEvent — aplicado vs falhou", () => {
  test("aplicado com sucesso não carrega marca de falha", () => {
    const result = buildInternalChangeEvent(adminBudgetChange());

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.changedFields[APPLY_FAILED_FIELD]).toBeUndefined();
    expect(isAppliedToMeta(result.event.changedFields)).toBe(true);
  });

  test("falha na Meta fica registrada no evento, com o diff tentado preservado", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        appliedToMeta: false,
        errorMessage: "Invalid parameter: daily_budget muito baixo",
      }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.changedFields.daily_budget).toEqual({
      old: "5000",
      new: "9000",
    });
    expect(result.event.changedFields[APPLY_FAILED_FIELD]).toEqual({
      old: null,
      new: "Invalid parameter: daily_budget muito baixo",
    });
    expect(isAppliedToMeta(result.event.changedFields)).toBe(false);
  });

  test("falha sem mensagem ainda assim marca o evento como não aplicado", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({ appliedToMeta: false }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(isAppliedToMeta(result.event.changedFields)).toBe(false);
  });
});

describe("campanha: o orçamento no nível em que a Meta o guarda", () => {
  test("subir o orçamento diário em CBO registra só o campo mexido", () => {
    const changes = campaignBudgetFieldChanges({
      mode: "CBO",
      previousDailyBudget: "5000",
      previousLifetimeBudget: null,
      nextDailyBudget: "9000",
    });

    expect(buildInternalChangeEvent(adminBudgetChange({ changes })).ok).toBe(true);
    expect(changes).toEqual([
      { field: "daily_budget", old: "5000", new: "9000" },
      { field: "lifetime_budget", old: null, new: null },
    ]);
  });

  test("migrar para ABO tira o dinheiro da campanha", () => {
    expect(
      campaignBudgetFieldChanges({
        mode: "ABO",
        previousDailyBudget: "5000",
        previousLifetimeBudget: null,
      }),
    ).toEqual([
      { field: "daily_budget", old: "5000", new: null },
      { field: "lifetime_budget", old: null, new: null },
    ]);
  });

  test("orçamento configurado zero não é valor — é o dinheiro no outro nível", () => {
    // Campanha que já estava em ABO: a Meta pode devolver "0" em vez de omitir.
    // Sem esta convenção o stream registraria "0 → nada", uma mudança que
    // ninguém fez — e que o normalizador da coleta jamais reconheceria.
    const changes = campaignBudgetFieldChanges({
      mode: "ABO",
      previousDailyBudget: "0",
      previousLifetimeBudget: "0",
    });

    const result = buildInternalChangeEvent(adminBudgetChange({ changes }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("resultado ok esperado");
    expect(result.event).toBeNull();
  });

  test("migrar de ABO para CBO faz o orçamento nascer na campanha", () => {
    expect(
      campaignBudgetFieldChanges({
        mode: "CBO",
        previousDailyBudget: "0",
        previousLifetimeBudget: null,
        nextDailyBudget: "9000",
      })[0],
    ).toEqual({ field: "daily_budget", old: null, new: "9000" });
  });

  test("conjunto registra apenas o tipo de orçamento que a rota escreveu", () => {
    expect(
      adsetBudgetFieldChanges({
        previousDailyBudget: null,
        newDailyBudget: "3000",
        previousLifetimeBudget: "12000",
        newLifetimeBudget: null,
      }),
    ).toEqual([{ field: "daily_budget", old: null, new: "3000" }]);
  });
});

describe("buildInternalChangeEvent — ponte com o log legado", () => {
  test("o evento novo referencia o registro legado gravado no mesmo dual-write", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        legacy: {
          table: "campaign_edit_logs",
          id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        },
      }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.legacyEditLogTable).toBe("campaign_edit_logs");
    expect(result.event.legacyEditLogId).toBe(
      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    );
  });

  test("sem log legado correspondente, a ponte fica nula", () => {
    const result = buildInternalChangeEvent(adminBudgetChange());

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.legacyEditLogTable).toBeNull();
    expect(result.event.legacyEditLogId).toBeNull();
  });

  test("hierarquia e nome desnormalizados chegam ao evento", () => {
    const result = buildInternalChangeEvent(
      adminBudgetChange({
        entityLevel: "adset",
        entityId: "120210000000000002",
        entityName: "Conjunto — Centro 5km",
        campaignId: "120210000000000001",
        adsetId: "120210000000000002",
      }),
    );

    if (!result.ok || !result.event) throw new Error("evento esperado");
    expect(result.event.entityLevel).toBe("adset");
    expect(result.event.entityId).toBe("120210000000000002");
    expect(result.event.campaignId).toBe("120210000000000001");
    expect(result.event.adsetId).toBe("120210000000000002");
    expect(result.event.entityName).toBe("Conjunto — Centro 5km");
  });
});
