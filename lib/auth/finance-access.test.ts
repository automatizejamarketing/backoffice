import { describe, expect, test } from "bun:test";
import { canAccessFinance } from "./finance-access";

describe("finance access", () => {
  test("allows only the explicit finance email list", () => {
    expect(canAccessFinance("joaopedro@layback.trade")).toBe(true);
    expect(canAccessFinance(" CONTATO@INFINITEGROWTH.COM.BR ")).toBe(true);
    expect(canAccessFinance("lucashaddadm@gmail.com")).toBe(true);
    expect(canAccessFinance("rafael@layback.me")).toBe(true);
    expect(canAccessFinance("gustavo@layback.trade")).toBe(true);
    expect(canAccessFinance("gustavoomarcelinoo@gmail.com")).toBe(true);
    expect(canAccessFinance("educacaoleg@gmail.com")).toBe(true);
    expect(canAccessFinance("admin@example.com")).toBe(false);
  });
});
