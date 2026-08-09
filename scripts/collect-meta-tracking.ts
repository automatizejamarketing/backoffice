/**
 * Coleta diária de tracking, disparada à mão (§5 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Mesmíssimo caminho do cron — as duas entradas chamam
 * `runDailyTrackingCollection` com as mesmas portas —, mudando só quem disparou
 * e os limites do lote. Serve para rodar a primeira coleta de um cliente, para
 * reprocessar uma conta que ficou parcial e para diagnosticar em produção sem
 * esperar a madrugada.
 *
 *   bun scripts/collect-meta-tracking.ts                 # lote padrão, só o pendente
 *   bun scripts/collect-meta-tracking.ts --all           # ignora a cobertura do dia
 *   bun scripts/collect-meta-tracking.ts --user=<uuid>   # um usuário (repetível)
 *   bun scripts/collect-meta-tracking.ts --max=5         # teto de contas neste disparo
 *
 * ATENÇÃO: escreve no banco apontado pelo ambiente carregado. Confira o
 * `APP_ENV` antes de rodar — os arquivos `.env` deste projeto não seguem a
 * intuição (ver o ticket 01 da feature).
 */

import { createDailyCollectionPorts } from "@/lib/meta-tracking/daily-collection-ports";
import { runDailyTrackingCollection } from "@/lib/meta-tracking/run-daily-collection";
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const onlyStale = !process.argv.includes("--all");
const userIds = process.argv
  .filter((arg) => arg.startsWith("--user="))
  .map((arg) => arg.slice("--user=".length))
  .filter(Boolean);
const maxAccounts = Number(flagValue("max"));

console.log(
  `[meta-tracking] iniciando coleta (${onlyStale ? "só contas pendentes hoje" : "todas as contas"}${
    userIds.length > 0 ? `, ${userIds.length} usuário(s)` : ""
  })…`,
);

const result = await runDailyTrackingCollection(createDailyCollectionPorts(), {
  triggeredBy: "script",
  onlyStale,
  userIds: userIds.length > 0 ? userIds : undefined,
  maxAccounts: Number.isFinite(maxAccounts) && maxAccounts > 0 ? maxAccounts : undefined,
  onProgress: ({ userEmail, accountId, status, metricRowsUpserted }) => {
    console.log(
      `[meta-tracking] ${userEmail} ${accountId} → ${status} (${metricRowsUpserted} dias de métrica)`,
    );
  },
});

console.log("\n=== Resumo ===");
console.log(
  JSON.stringify(
    {
      runId: result.runId,
      usersConsidered: result.usersConsidered,
      accountsSeen: result.accountsSeen,
      accountsProcessed: result.accountsProcessed,
      accountsCovered: result.accountsCovered,
      accountsPartial: result.accountsPartial,
      accountsFailed: result.accountsFailed,
      accountsSkipped: result.accountsSkipped,
      accountsAlreadyCovered: result.accountsAlreadyCovered,
      entitiesSeen: result.entitiesSeen,
      versionsCreated: result.versionsCreated,
      eventsCreated: result.eventsCreated,
      versionsConfirmed: result.versionsConfirmed,
      metricRowsUpserted: result.metricRowsUpserted,
      metricSlicesDegraded: result.metricSlicesDegraded,
      stoppedForBudget: result.stoppedForBudget,
    },
    null,
    2,
  ),
);

if (result.stoppedForBudget) {
  console.log(
    "\nO lote acabou antes da base: rode de novo para continuar de onde parou.",
  );
}

if (result.errors.length > 0) {
  console.log(`\n=== Erros (${result.errors.length}) ===`);
  for (const error of result.errors.slice(0, 50)) {
    console.log(
      `- ${error.userEmail}${error.accountId ? ` ${error.accountId}` : ""}: ${error.message}`,
    );
  }
}

process.exit(
  result.errors.length > 0 && result.accountsCovered === 0 ? 1 : 0,
);
