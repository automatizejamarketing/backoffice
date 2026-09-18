import Link from "next/link";
import { CheckCircle2, Inbox } from "lucide-react";
import {
  playbookAlertHrefWith,
  type PlaybookAlertFilters,
  type PlaybookAlertTab,
} from "@/lib/backoffice/playbook-alert-dashboard";
import { cn } from "@/lib/utils";

const TABS: Array<{
  value: PlaybookAlertTab;
  label: string;
  icon: typeof Inbox;
}> = [
  { value: "pending", label: "Pendentes", icon: Inbox },
  { value: "completed", label: "Finalizados", icon: CheckCircle2 },
];

export function AlertsTabsNav({
  filters,
  pendingCount,
  completedCount,
}: {
  filters: PlaybookAlertFilters;
  pendingCount: number;
  completedCount: number;
}) {
  return (
    <nav aria-label="Filas de alertas" className="overflow-x-auto border-b">
      <div className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.value === filters.tab;
          const count = tab.value === "pending" ? pendingCount : completedCount;
          return (
            <Link
              key={tab.value}
              href={playbookAlertHrefWith(filters, { tab: tab.value, page: 1 })}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {tab.label}
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
