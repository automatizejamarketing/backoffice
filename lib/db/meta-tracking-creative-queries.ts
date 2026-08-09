/**
 * Gravação e varredura dos snapshots de criativo em Postgres (§4.6 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Só I/O. Quem decide quem buscar e o que é uma linha é
 * `lib/meta-tracking/creative-snapshot.ts`; quem coordena é
 * `lib/meta-tracking/collect-creative-snapshots.ts`.
 *
 * ## As duas regras que este arquivo carrega
 *
 * 1. **A ausência de linha É a pendência.** Não há coluna de "criativo a
 *    buscar" em lugar nenhum: a varredura é um anti-join entre os `creative_id`
 *    das versões de anúncio da conta e a tabela de snapshots. É o que torna a
 *    coleta auto-corretiva — o passivo do backfill e o que falhou ontem
 *    reaparecem sozinhos, sem estado a manter.
 * 2. **TODAS as versões contam, não só a vigente.** Um criativo referenciado por
 *    uma versão antiga de anúncio é justamente o que responde "o que estava no
 *    ar antes da troca" — perdê-lo esvaziaria a correlação que o snapshot
 *    existe para permitir.
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { metaTrackingConfigVersion, metaTrackingCreative } from "@/lib/db/schema";
import type { CreativeSnapshotRow } from "@/lib/meta-tracking/creative-snapshot";

/**
 * Teto de ids devolvidos por varredura. Não é o teto de coleta (esse é do plano
 * puro, `MAX_CREATIVES_PER_ACCOUNT_RUN`): é uma válvula para que uma conta com
 * histórico enorme não traga dezenas de milhares de ids para a memória de uma
 * invocação. Quando o passivo passa disto, o contador de pendentes vira um piso
 * — o que sobrar aparece nas varreduras seguintes.
 */
const MAX_UNKNOWN_CREATIVE_IDS = 5_000;

/** Linhas por comando, no mesmo lote das outras gravações da fundação. */
const INSERT_BATCH_SIZE = 400;

/**
 * Os criativos referenciados por versões de anúncio desta conta que ainda não
 * têm snapshot.
 *
 * Anti-join por `LEFT JOIN … IS NULL`: a chave da tabela de snapshots é o
 * próprio id da Meta, então a busca de cada id é um acesso à chave primária.
 */
export async function listUnknownCreativeIds(args: {
  accountId: string;
}): Promise<string[]> {
  const rows = await db
    .selectDistinct({ creativeId: metaTrackingConfigVersion.creativeId })
    .from(metaTrackingConfigVersion)
    .leftJoin(
      metaTrackingCreative,
      eq(metaTrackingCreative.id, metaTrackingConfigVersion.creativeId),
    )
    .where(
      and(
        eq(metaTrackingConfigVersion.accountId, args.accountId),
        eq(metaTrackingConfigVersion.entityLevel, "ad"),
        isNotNull(metaTrackingConfigVersion.creativeId),
        isNull(metaTrackingCreative.id),
      ),
    )
    .limit(MAX_UNKNOWN_CREATIVE_IDS);

  return rows
    .map((row) => row.creativeId)
    .filter((id): id is string => id !== null);
}

/**
 * Grava os snapshots e devolve quantos NASCERAM.
 *
 * `ON CONFLICT (id) DO NOTHING` porque criativo é imutável: rebuscar e
 * reescrever seria trocar uma foto por outra idêntica, e o `fetched_at` deixaria
 * de responder "desde quando temos este conteúdo". O conflito também é o que
 * torna duas execuções simultâneas inofensivas.
 */
export async function insertCreativeSnapshots(
  rows: readonly CreativeSnapshotRow[],
): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    if (batch.length === 0) continue;

    const fetchedAt = new Date();
    const inserted = await db
      .insert(metaTrackingCreative)
      .values(
        batch.map((row) => ({
          id: row.id,
          accountId: row.accountId,
          spec: row.spec,
          fetchedAt,
        })),
      )
      .onConflictDoNothing({ target: metaTrackingCreative.id })
      .returning({ id: metaTrackingCreative.id });

    written += inserted.length;
  }

  return written;
}
