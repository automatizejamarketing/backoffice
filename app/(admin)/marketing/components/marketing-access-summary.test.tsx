import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AccessSummary } from "@/lib/subscriptions/access-summary";

import { MarketingAccessSummaryView } from "./marketing-access-summary";

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const stripeCanceling: AccessSummary = {
  access: { tone: "success", label: "Ativo até 30/09/2026", hint: "em 21 dias" },
  billing: {
    title: "Stripe/cartão · Starter Mensal",
    badge: { tone: "warning", label: "Ativa", hint: "cancela em 30/09/2026" },
  },
  notice: null,
};

describe("MarketingAccessSummaryView", () => {
  test("uma linha com acesso, quando vence e a cobrança", () => {
    const html = renderToStaticMarkup(
      <MarketingAccessSummaryView summary={stripeCanceling} />,
    );
    expect(textOf(html)).toBe(
      "Assinatura Ativo até 30/09/2026 em 21 dias · Stripe/cartão · Starter Mensal Ativa cancela em 30/09/2026",
    );
  });

  test("sem selo de cobrança, mostra o texto vazio da cobrança", () => {
    const html = renderToStaticMarkup(
      <MarketingAccessSummaryView
        summary={{
          access: { tone: "neutral", label: "Sem data de acesso" },
          billing: {
            title: "Sem cobrança registrada",
            badge: null,
            empty: "Nenhum Pix gerado para este cliente.",
          },
          notice: null,
        }}
      />,
    );
    expect(textOf(html)).toBe(
      "Assinatura Sem data de acesso · Sem cobrança registrada Nenhum Pix gerado para este cliente.",
    );
  });

  test("o aviso aparece só pelo título, com o detalhe ao passar o mouse", () => {
    const html = renderToStaticMarkup(
      <MarketingAccessSummaryView
        summary={{
          ...stripeCanceling,
          notice: {
            title: "Renovação pendente",
            detail: "O acesso venceu em 5 de setembro de 2026. Gere um novo Pix.",
          },
        }}
      />,
    );
    expect(textOf(html)).toMatch(/cancela em 30\/09\/2026 Renovação pendente$/);
    expect(html).toContain(
      'title="O acesso venceu em 5 de setembro de 2026. Gere um novo Pix."',
    );
  });
});
