import { describe, expect, test } from "bun:test";

import { hasIdentityChoice, preselectIdentity } from "./identity-step";

const page = (pageId: string, extra: { primary?: boolean; ig?: string } = {}) => ({
  pageId,
  instagramBusinessAccountId: extra.ig ?? `ig-${pageId}`,
  primary: extra.primary ?? false,
});

describe("hasIdentityChoice", () => {
  test("sem página ou com uma só não há o que perguntar", () => {
    expect(hasIdentityChoice([])).toBe(false);
    expect(hasIdentityChoice([page("a")])).toBe(false);
  });

  test("com duas ou mais páginas a etapa aparece", () => {
    expect(hasIdentityChoice([page("a"), page("b")])).toBe(true);
  });
});

describe("preselectIdentity", () => {
  test("sem páginas não há identidade", () => {
    expect(preselectIdentity([])).toBeNull();
  });

  test("sem página principal, a primeira é o padrão — como o fluxo sempre fez", () => {
    expect(preselectIdentity([page("a"), page("b")])).toEqual({
      pageId: "a",
      instagramUserId: "ig-a",
    });
  });

  test("a página principal da seleção fixa vence a ordem da lista", () => {
    expect(preselectIdentity([page("a"), page("b", { primary: true })])).toEqual({
      pageId: "b",
      instagramUserId: "ig-b",
    });
  });
});
