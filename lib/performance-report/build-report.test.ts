import { describe, expect, test } from "bun:test";
import {
  buildCampaignDiagnosticFacts,
  buildCampaignTable,
  type ConsolidatedCampaign,
} from "./facts";

const workspace = { userId: "user-1", datePreset: "last_30d" };

const baseCampaign = {
  accountId: "act_1",
  accountName: "Conta principal",
  startDate: "2026-08-01",
  stopDate: null,
  objective: "OUTCOME_SALES",
  tag: "ATIVA" as const,
  veiculacao: "Ativo",
  delivery: "active" as const,
  toggleAtivo: true,
  effectiveStatus: "ACTIVE",
  cpa: null,
  sampleCaveat: "limited" as const,
  sampleCaveatLabel: "conclusão limitada pelo tamanho da amostra",
} satisfies Omit<
  ConsolidatedCampaign,
  "id" | "name" | "roas" | "valorDeCompra" | "compras" | "gasto"
>;

describe("performance report tables and facts", () => {
  test("ranks only table campaigns and never mentions Slack fences", () => {
    const campaigns: ConsolidatedCampaign[] = [
      {
        ...baseCampaign,
        id: "winner",
        name: "Campanha vencedora",
        roas: 8,
        valorDeCompra: 800,
        compras: 10,
        cpa: 10,
        gasto: 100,
        sampleCaveat: "robust",
        sampleCaveatLabel: "conclusão robusta",
      },
      {
        ...baseCampaign,
        id: "attention",
        name: "Campanha sem compra",
        roas: null,
        valorDeCompra: 0,
        compras: 0,
        gasto: 150,
      },
      {
        ...baseCampaign,
        id: "secondary",
        name: "Campanha secundária",
        roas: 2,
        valorDeCompra: 200,
        compras: 2,
        cpa: 50,
        gasto: 100,
      },
    ];

    const facts = buildCampaignDiagnosticFacts(campaigns, {}, workspace);

    expect(facts.bestByRoas.at(0)?.id).toBe("winner");
    expect(facts.needsAttention.at(0)?.id).toBe("attention");
    expect(facts.activeWithoutPurchases.at(0)?.actionHint).toContain(
      "Já está ATIVA",
    );
    expect(facts.concentration.leadingCampaign?.id).toBe("winner");
    expect(facts.bestByRoas.at(0)?.workspaceUrl).toContain("campaignId=winner");
    expect(facts.evidenceRule.includes("slackBlocks")).toBe(false);
    expect(facts.evidenceRule.includes("```")).toBe(false);
  });

  test("builds structured rows without ASCII slackBlocks", () => {
    const campaigns: ConsolidatedCampaign[] = [
      {
        ...baseCampaign,
        id: "campaign",
        name: "Campanha",
        roas: 4,
        valorDeCompra: 400,
        compras: 4,
        cpa: 25,
        gasto: 100,
      },
    ];

    const table = buildCampaignTable(campaigns, true, {
      act_1: "Conta principal",
    });

    expect(table.columns).toEqual([
      "Conta",
      "Nome",
      "Início",
      "Status",
      "ROAS",
      "Valor de compra",
      "Compras",
      "CPA",
      "Gasto",
    ]);
    expect(table.rows.at(0)?.ValorDeCompra).toBe(400);
    expect(table.rows.at(0)?.Conta).toBe("Conta principal");
    expect(table.rowCount).toBe(1);
    expect("slackBlocks" in table).toBe(false);
  });
});
