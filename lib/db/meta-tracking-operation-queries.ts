/**
 * Consultas da tela de operação do tracking (§9 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Invólucros finos, no padrão `lib/db/*-queries.ts` da casa: carregam as linhas
 * de `meta_tracking_runs` e `meta_tracking_account_coverage` e entregam à
 * costura pura de `lib/meta-tracking/operation-view.ts`, que é quem decide o
 * que é execução completa, parcial ou falha e onde estão os buracos da série.
 *
 * Nenhuma regra de leitura é reescrita em SQL — se estivesse nos dois lugares,
 * a tela e um alerta futuro poderiam discordar sobre o que é um buraco.
 */

import { and, desc, eq, gte, isNotNull, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  metaTrackingAccountCoverage,
  metaTrackingRun,
  user,
} from "@/lib/db/schema";
import type { DayKey } from "@/lib/meta-tracking/correlation";
import type {
  CoverageRow,
  TrackingRunRow,
} from "@/lib/meta-tracking/operation-view";

const DEFAULT_RUN_LIMIT = 20;
const MAX_RUN_LIMIT = 100;

/** As execuções mais recentes, da mais nova para a mais antiga. */
export async function listRecentTrackingRuns(
  args: { limit?: number } = {},
): Promise<TrackingRunRow[]> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_RUN_LIMIT, 1), MAX_RUN_LIMIT);

  return db
    .select({
      id: metaTrackingRun.id,
      kind: metaTrackingRun.kind,
      triggeredBy: metaTrackingRun.triggeredBy,
      status: metaTrackingRun.status,
      startedAt: metaTrackingRun.startedAt,
      completedAt: metaTrackingRun.completedAt,
      errorMessage: metaTrackingRun.errorMessage,
      summary: metaTrackingRun.summary,
    })
    .from(metaTrackingRun)
    .orderBy(desc(metaTrackingRun.startedAt))
    .limit(limit);
}

/**
 * A cobertura conta×dia do período, com o email do cliente para a tela não
 * mostrar só ids de conta de anúncio.
 *
 * Vem sem filtro de usuário: o recorte de RBAC é
 * `filterCoverageRowsForActor`, que reusa a mesma regra das rotas de marketing.
 * Fazê-lo aqui exigiria repetir a regra em SQL.
 */
export async function listAccountCoverage(args: {
  from: DayKey;
  to: DayKey;
}): Promise<CoverageRow[]> {
  return db
    .select({
      accountId: metaTrackingAccountCoverage.accountId,
      userId: metaTrackingAccountCoverage.userId,
      userEmail: user.email,
      businessDate: metaTrackingAccountCoverage.businessDate,
      status: metaTrackingAccountCoverage.status,
      errorMessage: metaTrackingAccountCoverage.errorMessage,
      entitiesSeen: metaTrackingAccountCoverage.entitiesSeen,
      currency: metaTrackingAccountCoverage.currency,
      timezoneName: metaTrackingAccountCoverage.timezoneName,
      completedAt: metaTrackingAccountCoverage.completedAt,
    })
    .from(metaTrackingAccountCoverage)
    .leftJoin(user, eq(user.id, metaTrackingAccountCoverage.userId))
    .where(
      and(
        gte(metaTrackingAccountCoverage.businessDate, args.from),
        lte(metaTrackingAccountCoverage.businessDate, args.to),
      ),
    )
    .orderBy(
      metaTrackingAccountCoverage.accountId,
      metaTrackingAccountCoverage.businessDate,
    );
}

/**
 * A moeda da conta de anúncio, registrada pela cobertura mais recente que
 * conseguiu perguntá-la à Meta. É ela que dá sentido aos orçamentos do
 * histórico de ações — que chegam em unidades menores dessa moeda.
 *
 * `null` quando a conta nunca foi coletada com sucesso; a apresentação decide
 * o que fazer com isso.
 */
export async function getAccountTrackingCurrency(
  accountId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ currency: metaTrackingAccountCoverage.currency })
    .from(metaTrackingAccountCoverage)
    .where(
      and(
        eq(metaTrackingAccountCoverage.accountId, accountId),
        isNotNull(metaTrackingAccountCoverage.currency),
      ),
    )
    .orderBy(desc(metaTrackingAccountCoverage.businessDate))
    .limit(1);

  return row?.currency ?? null;
}
