import { Bell } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import {
  formatCalendarDateLabel,
} from "@/lib/backoffice/datetime-format";
import {
  normalizePlaybookAlertFilters,
  type PlaybookAlertSearchParams,
} from "@/lib/backoffice/playbook-alert-dashboard";
import { getPlaybookAlertDashboard } from "@/lib/db/playbook-alert-dashboard-queries";
import {
  DashboardFetchingIndicator,
  DashboardNavigationProvider,
} from "../dashboard-navigation-feedback";
import { AlertsFilters } from "./alerts-filters";
import { AlertsMetricCards } from "./alerts-metric-cards";
import { AlertsTable } from "./alerts-table";
import { AlertsTabsNav } from "./alerts-tabs-nav";
import { AlertsTrendChart } from "./alerts-trend-chart";
import { AlertsTypeChart } from "./alerts-type-chart";

export const dynamic = "force-dynamic";

export default async function AlertsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<PlaybookAlertSearchParams>;
}) {
  const [actor, sp] = await Promise.all([
    requirePagePermission("marketing:read"),
    searchParams,
  ]);
  const filters = normalizePlaybookAlertFilters(sp);
  const showConsultant = actor.role === "admin" || actor.role === "dev";
  const dashboard = await getPlaybookAlertDashboard(actor, filters);

  return (
    <DashboardNavigationProvider>
      <div className="mx-auto w-full max-w-[1500px] space-y-8">
        <header className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-chart-1" />
              Playbook de otimização
            </div>
            <div className="mt-2 flex items-center gap-2">
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                <Bell className="size-6" />
                Alertas
              </h1>
              <DashboardFetchingIndicator />
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Os mesmos alertas de performance enviados ao Slack, com comparação
              contra o período anterior equivalente e fila para o consultor
              concluir o que já foi tratado.
            </p>
          </div>

          <AlertsFilters filters={filters} />

          <AlertsTabsNav
            filters={filters}
            pendingCount={dashboard.kpis.pendingNow}
            completedCount={dashboard.kpis.completed.current}
          />
        </header>

        <AlertsMetricCards
          created={dashboard.kpis.created}
          completed={dashboard.kpis.completed}
          pendingNow={dashboard.kpis.pendingNow}
          treatmentRate={dashboard.kpis.treatmentRate}
          mostCommon={dashboard.kpis.mostCommon}
        />

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold">Novos vs finalizados</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatCalendarDateLabel(dashboard.window.fromDate)} a{" "}
                {formatCalendarDateLabel(dashboard.window.throughDate)} ·
                comparado a{" "}
                {formatCalendarDateLabel(dashboard.previousWindow.fromDate)} a{" "}
                {formatCalendarDateLabel(dashboard.previousWindow.throughDate)}
              </p>
            </div>
            <AlertsTrendChart data={dashboard.series} />
          </div>
          <div className="min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold">Tipos mais comuns</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Distribuição dos alertas criados no período.
              </p>
            </div>
            <AlertsTypeChart data={dashboard.types} />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">
              {filters.tab === "pending"
                ? "Fila operacional"
                : "Histórico finalizado"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {filters.tab === "pending"
                ? "Alertas abertos ou em andamento da carteira visível."
                : "Concluídos, dispensados e resolvidos automaticamente no período."}
            </p>
          </div>
          <AlertsTable
            filters={filters}
            rows={dashboard.table.rows}
            total={dashboard.table.total}
            showConsultant={showConsultant}
            canComplete={
              filters.tab === "pending" &&
              hasBackofficePermission(actor, "marketing:write")
            }
          />
        </section>
      </div>
    </DashboardNavigationProvider>
  );
}
