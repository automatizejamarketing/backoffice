import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MetaAssetsResponse } from "@/lib/backoffice/meta-assets-types";
import { MetaAssetsLists } from "./meta-assets-lists";

const granted: NonNullable<MetaAssetsResponse["granted"]> = {
  adAccounts: [
    { id: "111", name: "Conta principal", statusLabel: "Ativa", enabled: true, primary: true },
    { id: "333", name: "Conta não selecionada", statusLabel: "Ativa", enabled: false, primary: false },
  ],
  identities: [],
};
const enabled: NonNullable<MetaAssetsResponse["enabled"]> = {
  adAccounts: [
    { id: "111", name: "Conta principal", primary: true, available: true },
    { id: "222", name: "Conta sem acesso", primary: false, available: false },
  ],
  identities: [
    { id: "ig:444", name: "Loja", instagramUsername: "loja", primary: true, available: true },
  ],
};

describe("resumo dos ativos Meta", () => {
  test("mostra cada ativo selecionado uma vez, inclusive quando o acesso foi perdido", () => {
    const html = renderToStaticMarkup(
      <MetaAssetsLists granted={granted} enabled={enabled} limits={{ adAccounts: 3, identities: 2 }} />,
    );
    expect(html.split("Conta principal")).toHaveLength(2);
    expect(html).not.toContain("Conta não selecionada");
    expect(html).toContain("Conta sem acesso");
    expect(html).toContain("indisponível");
    expect(html).toContain("principal");
    expect(html).toContain("@loja");
    expect(html).toContain("2 habilitadas / limite 3");
    expect(html).toContain("1 habilitada / limite 2");
  });

  test("exibe os limites mesmo sem ativos selecionados", () => {
    const html = renderToStaticMarkup(
      <MetaAssetsLists
        granted={{ adAccounts: [], identities: [] }}
        enabled={{ adAccounts: [], identities: [] }}
        limits={{ adAccounts: 2, identities: 1 }}
      />,
    );
    expect(html).toContain("0 habilitadas / limite 2");
    expect(html).toContain("0 habilitadas / limite 1");
    expect(html).toContain("Nenhuma conta habilitada");
    expect(html).toContain("Nenhuma identidade habilitada");
  });
});
