import { describe, expect, test } from "bun:test";
import {
  CRM_COMMERCIAL_STATUS_VALUES,
  CRM_STATUS_META,
  deriveAccountStage,
  displayLeadName,
  isCrmCommercialStatus,
  normalizeCrmNote,
} from "./crm";

const NOW = new Date("2026-09-10T18:00:00.000Z");

describe("deriveAccountStage", () => {
  test("sem data de expiração é sem trial, com ou sem pagamento", () => {
    expect(deriveAccountStage({ expirationDate: null, hasApprovedPayment: false }, NOW)).toBe("sem_trial");
    expect(deriveAccountStage({ expirationDate: undefined, hasApprovedPayment: true }, NOW)).toBe("sem_trial");
  });

  test("trial é acesso sem pagamento; assinante é acesso com pagamento", () => {
    const future = "2026-09-20T00:00:00.000Z";
    const past = "2026-09-01T00:00:00.000Z";
    expect(deriveAccountStage({ expirationDate: future, hasApprovedPayment: false }, NOW)).toBe("trial_ativo");
    expect(deriveAccountStage({ expirationDate: past, hasApprovedPayment: false }, NOW)).toBe("trial_vencido");
    expect(deriveAccountStage({ expirationDate: new Date(future), hasApprovedPayment: true }, NOW)).toBe("assinante_ativo");
    expect(deriveAccountStage({ expirationDate: past, hasApprovedPayment: true }, NOW)).toBe("assinante_vencido");
  });
});

describe("status comercial", () => {
  test("todo status tem rótulo e o guard rejeita valores de fora", () => {
    for (const status of CRM_COMMERCIAL_STATUS_VALUES) {
      expect(CRM_STATUS_META[status].label.length).toBeGreaterThan(0);
      expect(isCrmCommercialStatus(status)).toBe(true);
    }
    expect(isCrmCommercialStatus("ganho")).toBe(false);
    expect(isCrmCommercialStatus(null)).toBe(false);
  });
});

describe("normalizeCrmNote", () => {
  test("apara espaços e rejeita vazio, não-string e texto longo demais", () => {
    expect(normalizeCrmNote("  ligar amanhã  ")).toBe("ligar amanhã");
    expect(normalizeCrmNote("   ")).toBeNull();
    expect(normalizeCrmNote(42)).toBeNull();
    expect(normalizeCrmNote("x".repeat(4_001))).toBeNull();
  });
});

describe("displayLeadName", () => {
  test("prefere nome, depois empresa, depois e-mail", () => {
    expect(displayLeadName({ name: "Ana", companyName: "Burger", email: "a@b.c" })).toBe("Ana");
    expect(displayLeadName({ name: " ", companyName: "Burger", email: "a@b.c" })).toBe("Burger");
    expect(displayLeadName({ name: null, companyName: null, email: "a@b.c" })).toBe("a@b.c");
  });
});
