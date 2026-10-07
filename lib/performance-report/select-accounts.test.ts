import { describe, expect, test } from "bun:test";
import {
  accountMatchesClientName,
  campaignHasManagedPrefix,
  selectReportAccounts,
} from "./select-accounts";

const midnight = {
  id: "act_505774308407338",
  name: "CA - Midnight Burger",
};
const cabello = {
  id: "act_222",
  name: "Mais Cabello - Pré Pago",
};
const infinite = {
  id: "act_333",
  name: "Infinite 02",
};

const connected = [midnight, cabello, infinite];

describe("selectReportAccounts", () => {
  test("Midnight case: managed account wins, recent-spend siblings stay out", () => {
    const selection = selectReportAccounts({
      connected,
      managedAccountIds: ["act_505774308407338"],
      clientName: "Gabriel - Midnight",
    });

    expect(selection.mode).toBe("automatize_managed");
    expect(selection.selected.map((row) => row.id)).toEqual([midnight.id]);
    expect(selection.skipped.map((row) => row.name)).toEqual([
      cabello.name,
      infinite.name,
    ]);
    expect(selection.summary).toContain("somente a conta CA - Midnight Burger");
    expect(selection.summary).toContain("Mais Cabello - Pré Pago");
    expect(selection.summary).toContain("Infinite 02");
  });

  test("recent spend never admits a foreign account on its own", () => {
    const selection = selectReportAccounts({
      connected,
      managedAccountIds: [],
      liveManagedAccountIds: [],
      clientName: "Gabriel - Midnight",
    });

    expect(selection.mode).toBe("name_match");
    expect(selection.selected.map((row) => row.name)).toEqual([midnight.name]);
    expect(selection.skipped.map((row) => row.name)).toEqual([
      cabello.name,
      infinite.name,
    ]);
  });

  test("without managed signal or name match, do not analyze every connected account", () => {
    const selection = selectReportAccounts({
      connected: [cabello, infinite],
      managedAccountIds: [],
      clientName: "Gabriel - Midnight",
    });

    expect(selection.mode).toBe("needs_choice");
    expect(selection.selected).toEqual([]);
    expect(selection.skipped).toHaveLength(2);
    expect(selection.summary).toContain("Peça qual conta analisar");
  });

  test("explicit accountId keeps the asked account even if it is not managed", () => {
    const selection = selectReportAccounts({
      connected,
      explicitAccountId: "222",
      managedAccountIds: [midnight.id],
      clientName: "Gabriel - Midnight",
    });

    expect(selection.mode).toBe("explicit");
    expect(selection.selected.map((row) => row.id)).toEqual([cabello.id]);
  });

  test("live [AM] prefix is enough when tracking cache is empty", () => {
    const selection = selectReportAccounts({
      connected,
      managedAccountIds: [],
      liveManagedAccountIds: [midnight.id],
      clientName: "Outro Cliente",
    });

    expect(selection.mode).toBe("automatize_managed");
    expect(selection.selected.map((row) => row.id)).toEqual([midnight.id]);
  });

  test("recent spend on a foreign account never pulls it in", () => {
    const selection = selectReportAccounts({
      connected,
      managedAccountIds: [midnight.id],
      recentSpendAccountIds: [cabello.id, infinite.id],
      clientName: "Gabriel - Midnight",
    });

    expect(selection.selected.map((row) => row.id)).toEqual([midnight.id]);
    expect(selection.skipped.map((row) => row.name)).toEqual([
      cabello.name,
      infinite.name,
    ]);
    expect(selection.summary).not.toContain("15 dias");
  });

  test("among two Automatize accounts, keeps only the one with recent spend", () => {
    const otherAm = { id: "act_444", name: "CA - Midnight Delivery" };
    const selection = selectReportAccounts({
      connected: [...connected, otherAm],
      managedAccountIds: [midnight.id, otherAm.id],
      recentSpendAccountIds: [midnight.id],
      clientName: "Gabriel - Midnight",
    });

    expect(selection.selected.map((row) => row.id)).toEqual([midnight.id]);
    expect(selection.skipped.map((row) => row.name)).toEqual([
      cabello.name,
      infinite.name,
      otherAm.name,
    ]);
    expect(selection.summary).toContain("gasto nos últimos 15 dias");
  });

  test("idle Automatize accounts stay in scope if none of them spent recently", () => {
    const otherAm = { id: "act_444", name: "CA - Midnight Delivery" };
    const selection = selectReportAccounts({
      connected: [...connected, otherAm],
      managedAccountIds: [midnight.id, otherAm.id],
      recentSpendAccountIds: [cabello.id],
      clientName: "Gabriel - Midnight",
    });

    expect(selection.selected.map((row) => row.id).sort()).toEqual(
      [midnight.id, otherAm.id].sort(),
    );
    expect(selection.skipped.map((row) => row.name)).toEqual([
      cabello.name,
      infinite.name,
    ]);
  });
});

describe("account name and managed prefix helpers", () => {
  test("matches Midnight burger to the client display name", () => {
    expect(
      accountMatchesClientName("CA - Midnight Burger", "Gabriel - Midnight"),
    ).toBe(true);
    expect(
      accountMatchesClientName("Mais Cabello - Pré Pago", "Gabriel - Midnight"),
    ).toBe(false);
  });

  test("detects Automatize-managed campaign names, including after a suffix rename", () => {
    expect(
      campaignHasManagedPrefix(
        "[AM][VENDAS][FS][2026-06-09-18-24-22] - Midnight.",
        "[AM]",
      ),
    ).toBe(true);
    expect(
      campaignHasManagedPrefix("[INFINITE] [FORMS] [LANDINGPAGE] [23.04]", "[AM]"),
    ).toBe(false);
  });
});

describe("selectReportAccounts — contas habilitadas pelo cliente", () => {
  const ca01 = { id: "act_4282062908742907", name: "CA 01 - Alpina Burguer" };
  const ca02 = { id: "act_1063291159876070", name: "CA 02 - Alpina Burguer" };
  const outra = { id: "act_999", name: "Outra Empresa" };

  test("Alpina: both enabled accounts, principal first, beat the managed heuristic", () => {
    const selection = selectReportAccounts({
      connected: [ca01, ca02, outra],
      enabledAccountIds: ["1063291159876070", "4282062908742907"],
      managedAccountIds: ["act_1063291159876070"],
    });

    expect(selection.mode).toBe("client_enabled");
    expect(selection.selected.map((row) => row.id)).toEqual([ca02.id, ca01.id]);
    expect(selection.skipped.map((row) => row.id)).toEqual([outra.id]);
    expect(selection.summary).toContain("todas as contas habilitadas pelo cliente");
    expect(selection.summary).toContain("separados por conta");
    expect(selection.summary).toContain("Fora do escopo: Outra Empresa");
  });

  test("enabled account the token no longer sees falls back to the old rules", () => {
    const selection = selectReportAccounts({
      connected: [ca01],
      enabledAccountIds: ["555"],
      managedAccountIds: ["act_4282062908742907"],
    });

    expect(selection.mode).toBe("automatize_managed");
    expect(selection.selected.map((row) => row.id)).toEqual([ca01.id]);
  });

  test("an explicit account still wins over the enabled set", () => {
    const selection = selectReportAccounts({
      connected: [ca01, ca02],
      explicitAccountId: "4282062908742907",
      enabledAccountIds: ["1063291159876070", "4282062908742907"],
      managedAccountIds: [],
    });

    expect(selection.mode).toBe("explicit");
    expect(selection.selected.map((row) => row.id)).toEqual([ca01.id]);
  });
});
