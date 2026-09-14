import { describe, expect, test } from "bun:test";
import {
  baseEmail,
  canEditCrmGoalMonth,
  crmGoalStatus,
  crmMonthCalendarBounds,
  crmMonthOf,
  crmRate,
  formatCrmMonth,
  isCrmMonth,
  isInternalLeadEmail,
  parseCrmGoalTarget,
  resolveCrmGoals,
  shiftCrmMonth,
} from "./crm-goals";

describe("semáforo", () => {
  test("verde na meta ou acima, laranja até 10 pontos abaixo, vermelho além", () => {
    expect(crmGoalStatus({ rate: 60, target: 60 })).toBe("on");
    expect(crmGoalStatus({ rate: 72.5, target: 60 })).toBe("on");
    expect(crmGoalStatus({ rate: 59.9, target: 60 })).toBe("near");
    expect(crmGoalStatus({ rate: 50, target: 60 })).toBe("near");
    expect(crmGoalStatus({ rate: 49.9, target: 60 })).toBe("off");
  });

  test("sem meta ou sem volume não julga", () => {
    expect(crmGoalStatus({ rate: 80, target: null })).toBe("neutral");
    expect(crmGoalStatus({ rate: null, target: 60 })).toBe("neutral");
  });

  test("taxa em pontos percentuais com uma casa; sem denominador é null", () => {
    expect(crmRate(12, 20)).toBe(60);
    expect(crmRate(1, 3)).toBe(33.3);
    expect(crmRate(0, 0)).toBeNull();
  });
});

describe("mês calendário", () => {
  test("valida, desloca e calcula limites", () => {
    expect(isCrmMonth("2026-09")).toBe(true);
    expect(isCrmMonth("2026-13")).toBe(false);
    expect(isCrmMonth("2026-9")).toBe(false);
    expect(shiftCrmMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftCrmMonth("2026-01", -1)).toBe("2025-12");
    expect(crmMonthCalendarBounds("2026-09")).toEqual({
      from: "2026-09-01",
      toExclusive: "2026-10-01",
    });
  });

  test("mês BRT: 1º de outubro 01h UTC ainda é setembro no Brasil", () => {
    expect(crmMonthOf(new Date("2026-10-01T01:00:00.000Z"))).toBe("2026-09");
    expect(crmMonthOf(new Date("2026-10-01T03:00:00.000Z"))).toBe("2026-10");
  });

  test("formata em português", () => {
    expect(formatCrmMonth("2026-09")).toBe("Setembro de 2026");
  });

  test("só o mês corrente e futuros aceitam edição", () => {
    const now = new Date("2026-09-14T12:00:00.000Z");
    expect(canEditCrmGoalMonth("2026-08", now)).toBe(false);
    expect(canEditCrmGoalMonth("2026-09", now)).toBe(true);
    expect(canEditCrmGoalMonth("2026-11", now)).toBe(true);
  });
});

describe("metas por mês com herança", () => {
  test("sem linhas usa o padrão em código", () => {
    const goals = resolveCrmGoals("2026-09", []);
    expect(goals.agendamento).toEqual({
      metric: "agendamento",
      target: 60,
      sourceMonth: null,
      inherited: true,
    });
    expect(goals.conversao_real.target).toBeNull();
  });

  test("herda a linha mais recente até o mês, ignora linhas futuras", () => {
    const rows = [
      { month: "2026-09", metric: "agendamento" as const, target: 60 },
      { month: "2026-11", metric: "agendamento" as const, target: 70 },
    ];
    expect(resolveCrmGoals("2026-10", rows).agendamento).toEqual({
      metric: "agendamento",
      target: 60,
      sourceMonth: "2026-09",
      inherited: true,
    });
    expect(resolveCrmGoals("2026-11", rows).agendamento.inherited).toBe(false);
    expect(resolveCrmGoals("2026-12", rows).agendamento.target).toBe(70);
  });

  test("uma linha com null desliga a meta dali em diante", () => {
    const rows = [{ month: "2026-10", metric: "conversao_trial" as const, target: null }];
    expect(resolveCrmGoals("2026-09", rows).conversao_trial.target).toBe(75);
    expect(resolveCrmGoals("2026-10", rows).conversao_trial.target).toBeNull();
  });

  test("meta é inteiro entre 0 e 100 ou null", () => {
    expect(parseCrmGoalTarget(60)).toBe(60);
    expect(parseCrmGoalTarget(null)).toBeNull();
    expect(parseCrmGoalTarget(60.5)).toBeUndefined();
    expect(parseCrmGoalTarget(101)).toBeUndefined();
    expect(parseCrmGoalTarget("60")).toBeUndefined();
  });
});

describe("contas da equipe", () => {
  test("ignora o +alias e maiúsculas", () => {
    expect(baseEmail("Fulano+Teste@Gmail.com")).toBe("fulano@gmail.com");
  });

  test("domínio da equipe, lista fixa e backoffice_users (com alias) são internos", () => {
    const team = ["contato@infinitegrowth.com.br", "daniele@exemplo.com"];
    expect(isInternalLeadEmail("alguem@layback.trade", team)).toBe(true);
    expect(isInternalLeadEmail("joaopedrocorrea14+sim1@gmail.com", team)).toBe(true);
    expect(isInternalLeadEmail("daniele+t1@exemplo.com", team)).toBe(true);
    expect(isInternalLeadEmail("cliente@exemplo.com", team)).toBe(false);
  });
});
