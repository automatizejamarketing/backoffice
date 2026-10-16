import { describe, expect, test } from "bun:test";

import { getAccountStatusLabel } from "./account";

describe("getAccountStatusLabel", () => {
  test("mapeia os status da Meta para os rótulos do app", () => {
    expect(getAccountStatusLabel(1)).toBe("Ativa");
    expect(getAccountStatusLabel(2)).toBe("Desativada");
    expect(getAccountStatusLabel(3)).toBe("Não quitada");
    expect(getAccountStatusLabel(7)).toBe("Em revisão de risco");
    expect(getAccountStatusLabel(8)).toBe("Aguardando pagamento");
    expect(getAccountStatusLabel(9)).toBe("Em período de carência");
    expect(getAccountStatusLabel(100)).toBe("Fechamento pendente");
    expect(getAccountStatusLabel(101)).toBe("Fechada");
  });

  test("status fora do mapa vira Desconhecida", () => {
    expect(getAccountStatusLabel(0)).toBe("Desconhecida");
    expect(getAccountStatusLabel(999)).toBe("Desconhecida");
  });
});
