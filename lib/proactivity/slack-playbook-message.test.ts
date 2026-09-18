import { describe, expect, test } from "bun:test";
import {
  buildPlaybookSlackMessage,
  playbookAlertDashboardUrl,
} from "./slack-playbook-message";

describe("playbookAlertDashboardUrl", () => {
  test("points at the alerts dashboard and can prefill the client search", () => {
    expect(playbookAlertDashboardUrl("https://backoffice.automatizemarketing.com/")).toBe(
      "https://backoffice.automatizemarketing.com/alerts",
    );
    expect(
      playbookAlertDashboardUrl(
        "https://backoffice.automatizemarketing.com",
        "Rômulo França",
      ),
    ).toBe(
      "https://backoffice.automatizemarketing.com/alerts?q=R%C3%B4mulo+Fran%C3%A7a",
    );
  });
});

describe("buildPlaybookSlackMessage", () => {
  test("keeps client and evidence once, without consultant or a second campaign line", () => {
    const evidence =
      'Campanha "[AM] [VENDAS] [FS] [2026-09-16-21-01-43]" com ROAS 7.53 (≥ 5) e gasto R$ 51.76.';

    expect(
      buildPlaybookSlackMessage({
        title: "ROAS validado — oportunidade de escala",
        clientLabel: "Rômulo França",
        evidence,
        dashboardUrl:
          "https://backoffice.automatizemarketing.com/alerts?q=R%C3%B4mulo+Fran%C3%A7a",
      }),
    ).toBe(
      [
        "*Playbook — ROAS validado — oportunidade de escala*",
        "Cliente: Rômulo França",
        evidence,
        "<https://backoffice.automatizemarketing.com/alerts?q=R%C3%B4mulo+Fran%C3%A7a|Abrir dashboard de alertas>",
      ].join("\n"),
    );
  });
});
