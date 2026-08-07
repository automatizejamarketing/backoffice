import { describe, expect, test } from "bun:test";
import type { BusinessPortfolioItem } from "@/lib/db/business-queries";
import {
  extractPhoneSearchDigits,
  matchesPortfolioSearch,
} from "./user-search";

describe("extractPhoneSearchDigits", () => {
  test("normalizes numbers with country code", () => {
    expect(extractPhoneSearchDigits("5521992448787")).toBe("21992448787");
    expect(extractPhoneSearchDigits("+55 (21) 99244-8787")).toBe("21992448787");
  });

  test("keeps local numbers and partial digit sequences", () => {
    expect(extractPhoneSearchDigits("21992448787")).toBe("21992448787");
    expect(extractPhoneSearchDigits("92448787")).toBe("92448787");
  });

  test("returns null when fewer than three digits", () => {
    expect(extractPhoneSearchDigits("12")).toBeNull();
    expect(extractPhoneSearchDigits("padaria")).toBeNull();
  });
});

describe("matchesPortfolioSearch", () => {
  const baseItem: Pick<
    BusinessPortfolioItem,
    | "userEmail"
    | "userPhone"
    | "companyName"
    | "consultantEmail"
    | "consultantName"
  > = {
    userEmail: "cliente@example.com",
    userPhone: "21992448787",
    companyName: "Padaria Central",
    consultantEmail: null,
    consultantName: null,
  };

  test("matches company name", () => {
    expect(matchesPortfolioSearch(baseItem, "padaria")).toBe(true);
  });

  test("matches email", () => {
    expect(matchesPortfolioSearch(baseItem, "cliente@example.com")).toBe(true);
  });

  test("matches phone with country code or formatting", () => {
    expect(matchesPortfolioSearch(baseItem, "5521992448787")).toBe(true);
    expect(matchesPortfolioSearch(baseItem, "(21) 99244-8787")).toBe(true);
    expect(matchesPortfolioSearch(baseItem, "92448787")).toBe(true);
  });

  test("does not match unrelated queries", () => {
    expect(matchesPortfolioSearch(baseItem, "outra empresa")).toBe(false);
    expect(matchesPortfolioSearch(baseItem, "5511999999999")).toBe(false);
  });
});
