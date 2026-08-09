/**
 * Promoção RETROATIVA das métricas conhecidas a colunas em
 * `meta_tracking_daily_metrics` (§4.2 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Percorre a série já gravada e preenche as colunas a partir do jsonb cru que
 * cada linha carrega — as famílias são o reservatório de promoção, e este
 * script é o que torna a promoção retroativa possível. A extração é
 * EXATAMENTE a mesma da escrita (`extractMetricColumns`): um ponto de verdade
 * só, ou o histórico antigo passaria a contar compra de um jeito e o novo de
 * outro.
 *
 *   bun scripts/backfill-metric-columns.ts                  # simulação (não escreve)
 *   bun scripts/backfill-metric-columns.ts --apply          # escreve
 *   bun scripts/backfill-metric-columns.ts --apply --after=<uuid>
 *   bun scripts/backfill-metric-columns.ts --apply --batch=200 --max-rows=5000
 *
 * **Simula por padrão.** `--apply` é obrigatório para escrever: o `.env` deste
 * projeto não segue a intuição (ver o ticket 01 da feature) e um UPDATE em
 * massa disparado no ambiente errado não tem volta.
 *
 * **Retomável e idempotente.** O cursor é keyset por `id`; a última linha de
 * cada lote é impressa e volta em `--after=<uuid>`. Reprocessar uma linha
 * escreve os mesmos valores — a extração é determinística.
 *
 * **O que NÃO é backfillável:** vídeo e `estimated_ad_recallers` nascem para
 * frente. Os campos que os alimentam entraram no field set de insights junto
 * com este ticket, então dia coletado antes disso não tem de onde tirá-los e
 * fica `NULL` — não é buraco, é a data em que a captura começou. Linhas
 * coletadas depois têm o reservatório `video_actions` e a própria coluna de
 * recall, e re-promovê-las devolve os mesmos valores.
 */

import {
  applyPromotedMetricColumns,
  listMetricRowsForPromotion,
} from "@/lib/db/meta-tracking-metrics-queries";
import { planMetricColumnPromotion } from "@/lib/meta-tracking/metric-columns";
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positiveNumber(name: string, fallback: number): number {
  const value = Number(flagValue(name));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const apply = process.argv.includes("--apply");
const batchSize = positiveNumber("batch", 500);
const maxRows = positiveNumber("max-rows", Number.MAX_SAFE_INTEGER);

console.log(
  `[metric-columns] ${apply ? "APLICANDO" : "simulação (use --apply para escrever)"} — lotes de ${batchSize}`,
);

let cursor = flagValue("after");
let scanned = 0;
let written = 0;

while (scanned < maxRows) {
  const rows = await listMetricRowsForPromotion({
    afterId: cursor,
    limit: Math.min(batchSize, maxRows - scanned),
  });

  const { updates, nextCursor } = planMetricColumnPromotion(rows);
  // Lote vazio não tem cursor: é assim que a varredura sabe que acabou.
  if (nextCursor === null) break;

  if (apply) written += await applyPromotedMetricColumns(updates);

  scanned += rows.length;
  cursor = nextCursor;
  console.log(
    `[metric-columns] ${scanned} linha(s) lidas, ${written} atualizada(s) — retomar com --after=${cursor}`,
  );
}

console.log(
  `[metric-columns] fim: ${scanned} linha(s) lidas, ${written} atualizada(s).` +
    (apply ? "" : " Nada foi escrito (simulação)."),
);

process.exit(0);
