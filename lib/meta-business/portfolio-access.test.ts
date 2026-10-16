import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchPortfolioAccess, uniqueCandidates } from "./portfolio-access";

const automatize = {
  name: "Automatize Marketing",
  actorAdminEmail: "lucas@example.com",
  businesses: [
    { id: "111", name: "Burger do Zé", permitted_roles: ["DEVELOPER", "ADMIN"] },
    { id: "222", name: "Pizzaria", permitted_roles: ["EMPLOYEE"] },
  ],
};

describe("matchPortfolioAccess", () => {
  it("is shared when a saved Facebook has full control of the client's portfolio", () => {
    const result = matchPortfolioAccess({
      candidates: [{ businessId: "111", name: null }],
      credentials: [automatize],
    });
    assert.equal(result.status, "shared");
    assert.deepEqual(result.matches, [
      {
        businessId: "111",
        businessName: "Burger do Zé",
        people: [
          { name: "Automatize Marketing", actorAdminEmail: "lucas@example.com", fullControl: true },
        ],
      },
    ]);
  });

  it("is partial when only an employee role sees the portfolio", () => {
    const result = matchPortfolioAccess({
      candidates: [{ businessId: "222", name: null }],
      credentials: [automatize],
    });
    assert.equal(result.status, "partial");
    assert.equal(result.matches[0]?.people[0]?.fullControl, false);
  });

  it("is not_shared when no saved Facebook sees the portfolio", () => {
    const result = matchPortfolioAccess({
      candidates: [{ businessId: "999", name: null }],
      credentials: [automatize],
    });
    assert.deepEqual(result, { status: "not_shared", matches: [] });
  });

  it("cannot check without credentials or a known portfolio", () => {
    assert.equal(
      matchPortfolioAccess({ candidates: [{ businessId: "111", name: null }], credentials: [] }).status,
      "no_credentials",
    );
    assert.equal(
      matchPortfolioAccess({ candidates: [], credentials: [automatize] }).status,
      "unknown_business",
    );
  });
});

describe("uniqueCandidates", () => {
  it("drops blanks and non-numeric ids and keeps the first known name", () => {
    assert.deepEqual(
      uniqueCandidates([
        { businessId: "111", name: null },
        { businessId: " 111 ", name: "Burger" },
        { businessId: "", name: "x" },
        { businessId: "act_1", name: "x" },
      ]),
      [{ businessId: "111", name: "Burger" }],
    );
  });
});
