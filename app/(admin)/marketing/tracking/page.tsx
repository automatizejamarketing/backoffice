import { requirePagePermission } from "@/lib/auth/rbac";
import { BACKOFFICE_TIME_ZONE } from "@/lib/backoffice/datetime-format";
import {
  listAccountCoverage,
  listRecentTrackingRuns,
} from "@/lib/db/meta-tracking-operation-queries";
import { dayKeyOf } from "@/lib/meta-tracking/correlation";
import {
  buildCoverageGrid,
  coverageDayRange,
  filterCoverageRowsForActor,
  serializeCoverageGrid,
  serializeTrackingRuns,
  summarizeTrackingRun,
} from "@/lib/meta-tracking/operation-view";
import { TrackingOperationClient } from "./tracking-operation-client";

// Página pesada de leitura agregada: mesma diretiva das outras telas do admin,
// pelo mesmo motivo (timeout de build na Vercel).
export const dynamic = "force-dynamic";

const RUNS_SHOWN = 15;
const COVERAGE_DAYS = 14;

export default async function MarketingTrackingPage() {
  const actor = await requirePagePermission("marketing:read");

  // O mesmo fuso que o coletor usa como dia de negócio para contas sem token —
  // a grade e a cobertura precisam concordar sobre onde "hoje" termina.
  const today = dayKeyOf(new Date(), BACKOFFICE_TIME_ZONE);
  const days = coverageDayRange(today, COVERAGE_DAYS);

  // A fundação de tracking pode ainda não existir no banco deste ambiente (a
  // migration é additiva e aplicada à parte). A tela de operação não pode
  // derrubar o painel inteiro por isso — ela informa e segue.
  let hasLoadError = false;
  let runs: Awaited<ReturnType<typeof listRecentTrackingRuns>> = [];
  let coverage: Awaited<ReturnType<typeof listAccountCoverage>> = [];

  try {
    [runs, coverage] = await Promise.all([
      listRecentTrackingRuns({ limit: RUNS_SHOWN }),
      listAccountCoverage({ from: days[0]!, to: days[days.length - 1]! }),
    ]);
  } catch (error) {
    // O detalhe fica no log do servidor: mensagem de erro de banco carrega
    // nomes de host e credenciais, e a tela não precisa deles para informar.
    console.error("[marketing/tracking] falha ao carregar a operação", error);
    hasLoadError = true;
  }

  const now = new Date();
  const grid = buildCoverageGrid({
    days,
    rows: filterCoverageRowsForActor(coverage, actor),
  });

  return (
    <TrackingOperationClient
      hasLoadError={hasLoadError}
      today={today}
      runs={serializeTrackingRuns(
        runs.map((run) => summarizeTrackingRun(run, now)),
      )}
      grid={serializeCoverageGrid(grid)}
    />
  );
}
