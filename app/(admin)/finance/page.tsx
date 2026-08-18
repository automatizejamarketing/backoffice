import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/rbac";
import { canAccessFinance } from "@/lib/auth/finance-access";
import { resolveDashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import {
  resolveFinancePaymentSource,
  resolveFinanceTab,
  type FinanceSearchParams,
} from "@/lib/backoffice/finance-search-params";
import { listAutomatizePaymentNetGaps } from "@/lib/backoffice/finance-payments";
import { getFinanceDashboard } from "@/lib/db/admin-queries";
import {
  listFinanceAutomatizePayments,
  listFinanceProductPayments,
} from "@/lib/db/finance-payment-queries";
import {
  DashboardFetchingIndicator,
  DashboardNavigationProvider,
} from "../dashboard-navigation-feedback";
import { FinanceDateFilter } from "./finance-date-filter";
import { FinanceOverview } from "./finance-overview";
import { FinancePaymentsPanel } from "./finance-payments-panel";
import { FinanceTabsNav } from "./finance-tabs-nav";

export const dynamic = "force-dynamic";

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<FinanceSearchParams>;
}) {
  const [actor, params] = await Promise.all([
    requirePagePermission("finance:view", "/"),
    searchParams,
  ]);
  if (!canAccessFinance(actor.email)) redirect("/");

  const window = resolveDashboardDateWindow(params);
  const activeTab = resolveFinanceTab(params);
  const activeSource = resolveFinancePaymentSource(params);
  const backfillQuery = new URLSearchParams({
    range: window.preset,
    from: window.fromDate,
    to: window.throughDate,
  }).toString();

  const [finance, automatizePayments, productPayments] = await Promise.all([
    activeTab === "visao" ? getFinanceDashboard(window) : Promise.resolve(null),
    activeTab === "pagamentos" && activeSource === "automatize"
      ? listFinanceAutomatizePayments(window)
      : Promise.resolve(null),
    activeTab === "pagamentos" && activeSource === "produtos"
      ? listFinanceProductPayments(window)
      : Promise.resolve(null),
  ]);

  const netGaps =
    automatizePayments && activeSource === "automatize"
      ? listAutomatizePaymentNetGaps(
          automatizePayments.rows,
          automatizePayments.stripeSettlements,
        )
      : [];

  return (
    <DashboardNavigationProvider>
      <div className="mx-auto w-full max-w-[1500px] space-y-8">
        <header className="space-y-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Receita recorrente e caixa
            </div>
            <div className="mt-2 flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Financeiro
              </h1>
              <DashboardFetchingIndicator />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {activeTab === "pagamentos"
                ? "Consulte todos os pagamentos aprovados no período, separados entre receita do Automatize e vendas de produtos."
                : "Acompanhe a saúde financeira da base e quanto entrou líquido no período selecionado."}
            </p>
          </div>

          <FinanceTabsNav
            activeTab={activeTab}
            activeSource={activeSource}
            window={window}
          />

          {activeTab === "pagamentos" ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Período financeiro</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Filtra os pagamentos listados abaixo.
                </p>
              </div>
              <FinanceDateFilter
                window={window}
                tab={activeTab}
                source={activeSource}
              />
            </div>
          ) : null}
        </header>

        {activeTab === "pagamentos" ? (
          <FinancePaymentsPanel
            source={activeSource}
            summary={
              activeSource === "automatize"
                ? (automatizePayments?.summary ?? {
                    count: 0,
                    grossCentavos: 0,
                    netCentavos: 0,
                    feeCentavos: 0,
                    netCoveragePayments: 0,
                    netBreakdown: {
                      newSubscriptionNetCentavos: 0,
                      renewalNetCentavos: 0,
                      newSubscriptionCount: 0,
                      renewalCount: 0,
                    },
                  })
                : (productPayments?.summary ?? {
                    count: 0,
                    grossCentavos: 0,
                    netCentavos: 0,
                    feeCentavos: 0,
                    netCoveragePayments: 0,
                  })
            }
            automatizePayments={automatizePayments?.rows}
            stripeSettlements={automatizePayments?.stripeSettlements}
            productPayments={productPayments?.rows}
            netGaps={netGaps}
            backfillQuery={backfillQuery}
          />
        ) : finance ? (
          <FinanceOverview
            summary={finance.summary}
            window={window}
            source={activeSource}
          />
        ) : null}
      </div>
    </DashboardNavigationProvider>
  );
}
