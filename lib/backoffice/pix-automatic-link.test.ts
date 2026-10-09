import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pixAutomaticLink } from "./pix-automatic-link";
import { PLAN_DEFINITIONS, PLAN_TYPES } from "@/lib/stripe/plans";
import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";

describe("links do Pix Automático no Backoffice", () => {
  it("usa o checkout automático e o preço integral em todos os períodos", () => {
    for (const plan of PLAN_TYPES) {
      const result = pixAutomaticLink(plan, "https://www.automatizemarketing.com");
      const url = new URL(result.url);
      assert.equal(url.pathname, "/app/assinar-plano");
      assert.equal(url.searchParams.get("method"), "pix_automatic");
      assert.equal(url.searchParams.get("plan"), plan);
      assert.equal(url.searchParams.size, 2); // no user identity, CPF, or trial bypass
      const definition = PLAN_DEFINITIONS[plan];
      assert.ok(result.price.includes(new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(definition.totalCommitmentCentavos / 100)));
      assert.ok(result.price.endsWith(definition.commitmentMonths === 1 ? "por mês" : `a cada ${definition.commitmentMonths} meses`));
    }
  });
  it("preserva o ambiente de staging", () => {
    assert.equal(new URL(pixAutomaticLink("monthly_starter", "https://staging.automatizemarketing.com/").url).host, "staging.automatizemarketing.com");
  });
  it("resolve o link com a variável documentada e o ambiente de staging", () => {
    for (const env of [
      { FRONTEND_URL: "https://staging.automatizemarketing.com" },
      { APP_ENV: "staging" },
    ]) {
      const result = pixAutomaticLink("monthly_starter", resolveFrontendAppUrl(env));
      assert.equal(new URL(result.url).origin, "https://staging.automatizemarketing.com");
    }
  });
});
