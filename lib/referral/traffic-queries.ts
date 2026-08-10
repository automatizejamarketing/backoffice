// A leitura do painel de tráfego (dashboard de origens dos afiliados v2).
//
// A classificação de user-agent/referrer não é expressável em SQL sem
// reescrever o classificador duas vezes, então a divisão é: o banco entrega as
// linhas cruas do período (só as colunas que o classificador lê) e
// `traffic.ts` decide tudo em memória. O volume torna isso viável — cliques de
// afiliado são milhares, não milhões — e o teto abaixo transforma "cresceu
// demais" em aviso explícito no painel em vez de latência silenciosa.

import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  referralAffiliate,
  referralAttribution,
  referralClick,
  user,
} from "@/lib/db/schema";
import {
  buildReferralTrafficReport,
  type ReferralTrafficReport,
} from "./traffic";

/**
 * Teto de linhas trazidas para classificar. Acima disso o painel avisa que o
 * recorte está truncado — um número parcial anunciado vale mais que um total
 * falso.
 */
const CLICK_FETCH_LIMIT = 100_000;

export type ReferralTrafficAffiliateOption = {
  id: string;
  code: string;
  name: string | null;
  email: string;
};

export type ReferralTrafficResponse = ReferralTrafficReport & {
  generatedAt: string;
  truncated: boolean;
  /** Afiliados que podem ser filtrados — todo aprovado ou bloqueado. */
  affiliates: ReferralTrafficAffiliateOption[];
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida o filtro de afiliado vindo da query string; inválido = sem filtro. */
export function parseTrafficAffiliateId(value: string | null): string | null {
  return value && UUID_PATTERN.test(value) ? value : null;
}

export async function getReferralTrafficReport(options: {
  days: number | null;
  affiliateId?: string | null;
  now?: Date;
}): Promise<ReferralTrafficResponse> {
  const now = options.now ?? new Date();
  const cutoff =
    options.days === null
      ? null
      : new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);

  const clickFilters = [
    cutoff ? gte(referralClick.createdAt, cutoff) : undefined,
    options.affiliateId
      ? eq(referralClick.affiliateId, options.affiliateId)
      : undefined,
  ].filter((filter) => filter !== undefined);

  const [clicks, wonRows, affiliates] = await Promise.all([
    db
      .select({
        id: referralClick.id,
        visitorId: referralClick.visitorId,
        userAgent: referralClick.userAgent,
        referrerUrl: referralClick.referrerUrl,
        landingUrl: referralClick.landingUrl,
      })
      .from(referralClick)
      .where(clickFilters.length > 0 ? and(...clickFilters) : undefined)
      // Mais recentes primeiro: quando o teto corta, cai a cauda antiga.
      .orderBy(desc(referralClick.createdAt))
      .limit(CLICK_FETCH_LIMIT + 1),
    // Os cliques vencedores da atribuição — cada linha é um cadastro. O join
    // reaplica o MESMO recorte de período/afiliado do clique, para que o
    // cadastro só apareça se o clique que o produziu está no relatório.
    db
      .select({ clickId: referralAttribution.clickId })
      .from(referralAttribution)
      .innerJoin(
        referralClick,
        eq(referralClick.id, referralAttribution.clickId),
      )
      .where(
        and(eq(referralAttribution.outcome, "won"), ...clickFilters),
      ),
    db
      .select({
        id: referralAffiliate.id,
        code: referralAffiliate.code,
        name: user.name,
        email: user.email,
      })
      .from(referralAffiliate)
      .innerJoin(user, eq(user.id, referralAffiliate.userId))
      // Pendentes e recusados nunca produziram clique; só poluiriam o filtro.
      .where(inArray(referralAffiliate.status, ["approved", "blocked"]))
      .orderBy(referralAffiliate.code),
  ]);

  const truncated = clicks.length > CLICK_FETCH_LIMIT;
  const rows = truncated ? clicks.slice(0, CLICK_FETCH_LIMIT) : clicks;
  const wonClickIds = new Set(wonRows.map((row) => row.clickId));

  return {
    ...buildReferralTrafficReport(rows, wonClickIds),
    generatedAt: now.toISOString(),
    truncated,
    affiliates,
  };
}

/**
 * Contagem total de cliques do recorte, sem teto — usada nos testes de
 * integração para conferir que o teto de leitura não silencia linhas.
 */
export async function countReferralClicks(options: {
  days: number | null;
  affiliateId?: string | null;
  now?: Date;
}): Promise<number> {
  const now = options.now ?? new Date();
  const cutoff =
    options.days === null
      ? null
      : new Date(now.getTime() - options.days * 24 * 60 * 60 * 1000);

  const filters = [
    cutoff ? gte(referralClick.createdAt, cutoff) : undefined,
    options.affiliateId
      ? eq(referralClick.affiliateId, options.affiliateId)
      : undefined,
  ].filter((filter) => filter !== undefined);

  const [row] = await db
    .select({ total: count() })
    .from(referralClick)
    .where(filters.length > 0 ? and(...filters) : undefined);
  return Number(row?.total ?? 0);
}
