/**
 * Backfill de 13 meses de série diária + baseline de configuração (§6 do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * Roda na ATIVAÇÃO de cada conta e é retomável: cada fatia concluída é gravada
 * na hora, então rodar de novo continua de onde parou em vez de refazer. A
 * janela de 37 meses da Meta desliza um dia por dia — o que não for capturado
 * agora não volta.
 *
 *   bun scripts/backfill-meta-tracking.ts --user=<uuid>        # um cliente (repetível)
 *   bun scripts/backfill-meta-tracking.ts --user=<uuid> --account=act_123
 *   bun scripts/backfill-meta-tracking.ts --all                # a base inteira, em lotes
 *   bun scripts/backfill-meta-tracking.ts --user=<uuid> --calls=600
 *   bun scripts/backfill-meta-tracking.ts --user=<uuid> --slice-days=15
 *   bun scripts/backfill-meta-tracking.ts --user=<uuid> --redo-baseline
 *
 * `--user` ou `--all` é obrigatório de propósito: um backfill da base inteira
 * disparado sem querer consome cota de todas as contas na mesma noite.
 *
 * ATENÇÃO: escreve no banco apontado pelo ambiente carregado. Confira o
 * `APP_ENV` antes de rodar — os arquivos `.env` deste projeto não seguem a
 * intuição (ver o ticket 01 da feature).
 */

import { createBackfillPorts } from "@/lib/meta-tracking/backfill-ports";
import { runMetaTrackingBackfill } from "@/lib/meta-tracking/run-backfill";
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function positiveNumber(name: string): number | undefined {
  const value = Number(flagValue(name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function repeatedFlag(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv
    .filter((arg) => arg.startsWith(prefix))
    .map((arg) => arg.slice(prefix.length))
    .filter(Boolean);
}

const userIds = repeatedFlag("user");
const accountIds = repeatedFlag("account");
const all = process.argv.includes("--all");

if (userIds.length === 0 && !all) {
  console.error(
    "Informe --user=<uuid> (repetível) ou --all. Sem isso o backfill percorreria a base inteira sem querer.",
  );
  process.exit(1);
}

console.log(
  `[meta-tracking-backfill] iniciando (${
    userIds.length > 0 ? `${userIds.length} usuário(s)` : "base inteira"
  }${accountIds.length > 0 ? `, ${accountIds.length} conta(s)` : ""})…`,
);

const result = await runMetaTrackingBackfill(createBackfillPorts(), {
  triggeredBy: "script",
  userIds: userIds.length > 0 ? userIds : undefined,
  accountIds: accountIds.length > 0 ? accountIds : undefined,
  months: positiveNumber("months"),
  sliceDays: positiveNumber("slice-days"),
  maxAccounts: positiveNumber("max-accounts"),
  maxApiCallsPerAccount: positiveNumber("calls"),
  redoBaseline: process.argv.includes("--redo-baseline"),
  onProgress: ({ userEmail, accountId, status, slicesCompleted, metricRowsUpserted, remainingDays }) => {
    console.log(
      `[meta-tracking-backfill] ${userEmail} ${accountId} → ${status} (${slicesCompleted} fatia(s), ${metricRowsUpserted} dias gravados, faltam ${remainingDays} dias)`,
    );
  },
});

console.log("\n=== Resumo ===");
console.log(
  JSON.stringify(
    {
      runId: result.runId,
      usersConsidered: result.usersConsidered,
      usersSkipped: result.usersSkipped,
      accountsSeen: result.accountsSeen,
      accountsProcessed: result.accountsProcessed,
      accountsCompleted: result.accountsCompleted,
      accountsPartial: result.accountsPartial,
      accountsFailed: result.accountsFailed,
      baselinesCreated: result.baselinesCreated,
      baselineVersionsCreated: result.baselineVersionsCreated,
      slicesCompleted: result.slicesCompleted,
      metricRowsUpserted: result.metricRowsUpserted,
      metricSlicesDegraded: result.metricSlicesDegraded,
      remainingDays: result.remainingDays,
      apiCallsUsed: result.apiCallsUsed,
      stoppedForBudget: result.stoppedForBudget,
    },
    null,
    2,
  ),
);

if (result.remainingDays > 0 || result.stoppedForBudget) {
  console.log(
    "\nAinda falta período: rode de novo (amanhã ou agora) para continuar de onde parou.",
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
  result.errors.length > 0 && result.slicesCompleted === 0 ? 1 : 0,
);
