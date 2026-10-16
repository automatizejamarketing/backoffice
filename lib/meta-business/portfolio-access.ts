/**
 * "Conectar pelo portfólio": does anyone at Automatize already have full
 * control of the client's Meta portfolio (the client invited
 * contato@automatizemarketing.com or a consultant under Pessoas)? If so a
 * consultant can run the BISU login for the client and the client does
 * nothing.
 *
 * Pure part: the server side (`portfolio-access-server.ts`) collects the
 * client's known portfolios and, for each saved consultant Facebook
 * (`meta_consultant_credentials`), the portfolios that Facebook can open.
 */

/** BISU Login for Business installs only for someone with full control. */
const FULL_CONTROL_ROLE = "ADMIN";

export type PortfolioCandidate = {
  businessId: string;
  name: string | null;
};

export type CredentialPortfolios = {
  /** Facebook profile name of the saved login (e.g. "Automatize Marketing"). */
  name: string | null;
  /** Backoffice account that saved it. */
  actorAdminEmail: string;
  businesses: ReadonlyArray<{
    id: string;
    name?: string | null;
    permitted_roles?: string[] | null;
  }>;
};

export type PortfolioPerson = {
  name: string | null;
  actorAdminEmail: string;
  fullControl: boolean;
};

export type PortfolioMatch = {
  businessId: string;
  businessName: string | null;
  people: PortfolioPerson[];
};

export type PortfolioAccessStatus =
  /** At least one saved Facebook has full control of the client's portfolio. */
  | "shared"
  /** Someone sees the portfolio, but nobody with full control. */
  | "partial"
  /** Portfolio known, no saved Facebook has it. */
  | "not_shared"
  /** We don't know the client's portfolio (never connected with BISU). */
  | "unknown_business"
  /** Nobody saved a Facebook yet, so nothing can be checked. */
  | "no_credentials";

export function uniqueCandidates(
  candidates: ReadonlyArray<PortfolioCandidate>,
): PortfolioCandidate[] {
  const byId = new Map<string, PortfolioCandidate>();
  for (const candidate of candidates) {
    const id = candidate.businessId?.trim();
    if (!id || !/^\d+$/.test(id)) continue;
    const existing = byId.get(id);
    byId.set(id, { businessId: id, name: existing?.name ?? candidate.name ?? null });
  }
  return [...byId.values()];
}

export function matchPortfolioAccess(args: {
  candidates: ReadonlyArray<PortfolioCandidate>;
  credentials: ReadonlyArray<CredentialPortfolios>;
}): { status: PortfolioAccessStatus; matches: PortfolioMatch[] } {
  const candidates = uniqueCandidates(args.candidates);
  if (args.credentials.length === 0) {
    return { status: "no_credentials", matches: [] };
  }
  if (candidates.length === 0) {
    return { status: "unknown_business", matches: [] };
  }

  const matches: PortfolioMatch[] = [];
  for (const candidate of candidates) {
    const people: PortfolioPerson[] = [];
    let businessName = candidate.name;
    for (const credential of args.credentials) {
      const business = credential.businesses.find(
        (item) => item.id === candidate.businessId,
      );
      if (!business) continue;
      businessName = businessName ?? business.name ?? null;
      people.push({
        name: credential.name,
        actorAdminEmail: credential.actorAdminEmail,
        fullControl: (business.permitted_roles ?? []).includes(FULL_CONTROL_ROLE),
      });
    }
    if (people.length > 0) {
      matches.push({ businessId: candidate.businessId, businessName, people });
    }
  }

  if (matches.some((match) => match.people.some((person) => person.fullControl))) {
    return { status: "shared", matches };
  }
  return { status: matches.length > 0 ? "partial" : "not_shared", matches };
}
