import Link from "next/link";
import { LayoutDashboard, UsersRound } from "lucide-react";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import {
  buildDashboardHref,
  type DashboardTab,
} from "@/lib/backoffice/dashboard-search-params";
import { cn } from "@/lib/utils";

const TABS: Array<{
  value: DashboardTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { value: "visao", label: "Visão geral", icon: LayoutDashboard },
  { value: "retencao", label: "Retenção de pagantes", icon: UsersRound },
];

export function DashboardTabsNav({
  activeTab,
  window,
}: {
  activeTab: DashboardTab;
  window: DashboardDateWindow;
}) {
  return (
    <nav aria-label="Visões do painel" className="overflow-x-auto border-b">
      <div className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.value === activeTab;
          return (
            <Link
              key={tab.value}
              href={buildDashboardHref(tab.value, window)}
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
  );
}
