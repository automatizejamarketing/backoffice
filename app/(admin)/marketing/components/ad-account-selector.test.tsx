import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AdAccountSelector } from "./ad-account-selector";

const accounts = [
  { id: "act_111", name: "Karinne Correa CA", accountId: "111", enabled: true, primary: true },
  { id: "act_222", name: "Loja Norte", accountId: "222" },
];

function renderTrigger(selectedAccountId: string | null) {
  const html = renderToStaticMarkup(
    <AdAccountSelector
      accounts={accounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={() => {}}
    />,
  );
  const trigger = html.match(/<button[^>]*data-slot="select-trigger"[^>]*>([\s\S]*?)<\/button>/);
  if (!trigger) throw new Error(`gatilho não renderizado: ${html}`);
  // O Radix renderiza o Select.Value como <span style="pointer-events:none">.
  const value = trigger[1].match(/^<span style="pointer-events:none">([\s\S]*?)<\/span><svg/);
  return { trigger: trigger[1], value: value?.[1] ?? null };
}

describe("AdAccountSelector — gatilho", () => {
  // O Select.Value do Radix ignora `className` (um `sr-only` nunca chega ao DOM) e, sem children,
  // espelha no gatilho o conteúdo inteiro do item selecionado (avatar, nome, ID, selos) — o nome
  // aparecia duas vezes. Com o conteúdo como children do Value, o espelho não acontece.
  test("o conteúdo da conta selecionada é o próprio Select.Value, sem cópia ao lado", () => {
    const { trigger, value } = renderTrigger("111");
    expect(value).not.toBeNull();
    expect(value).toContain("Karinne Correa CA");
    expect(value).toContain("habilitada");
    expect(value).toContain("principal");
    // Nada do conteúdo fica fora do Value: o gatilho é só o Value + o ícone.
    expect(trigger.split("Karinne Correa CA")).toHaveLength(2);
    expect(trigger).not.toContain("ID:");
  });

  test("sem conta selecionada, o Value mostra o texto de escolha", () => {
    const { value } = renderTrigger(null);
    expect(value).toContain("Selecione uma conta");
  });

  test("conta selecionada fora da lista cai no texto de escolha", () => {
    const { value } = renderTrigger("999");
    expect(value).toContain("Selecione uma conta");
  });
});
