"use client";

import Link from "next/link";
import { LayoutDashboard, Receipt } from "lucide-react";
import {
  buildFinanceHref,
  type FinancePaymentSource,
  type FinanceTab,
} from "@/lib/backoffice/finance-search-params";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import { cn } from "@/lib/utils";

const TAB_CONFIG: Array<{
  value: FinanceTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { value: "visao", label: "Visão geral", icon: LayoutDashboard },
  { value: "pagamentos", label: "Pagamentos", icon: Receipt },
];

const SOURCE_CONFIG: Array<{
  value: FinancePaymentSource;
  label: string;
  description: string;
}> = [
  {
    value: "automatize",
    label: "Automatize",
    description: "Assinaturas e planos da plataforma",
  },
  {
    value: "produtos",
    label: "Produtos",
    description: "Vendas de produtos digitais",
  },
];

type FinanceTabsNavProps = {
  activeTab: FinanceTab;
  activeSource: FinancePaymentSource;
  window: DashboardDateWindow;
};

export function FinanceTabsNav({
  activeTab,
  activeSource,
  window,
}: FinanceTabsNavProps) {
  const dateParams = {
    range: window.preset === "custom" ? "custom" : window.preset,
    from: window.fromDate,
    to: window.throughDate,
  };

  return (
    <div className="space-y-4">
      <nav className="overflow-x-auto border-b">
        <div className="flex min-w-max gap-1">
          {TAB_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const active = tab.value === activeTab;
            return (
              <Link
                key={tab.value}
                href={buildFinanceHref({
                  tab: tab.value,
                  source: activeSource,
                  ...dateParams,
                })}
                className={cn(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {activeTab === "pagamentos" ? (
        <div className="flex flex-wrap gap-2">
          {SOURCE_CONFIG.map((source) => {
            const active = source.value === activeSource;
            return (
              <Link
                key={source.value}
                href={buildFinanceHref({
                  tab: "pagamentos",
                  source: source.value,
                  ...dateParams,
                })}
                className={cn(
                  "rounded-lg border px-3 py-2 transition-colors",
                  active
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <p className="text-sm font-medium">{source.label}</p>
                <p className="text-[11px] leading-snug">{source.description}</p>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
