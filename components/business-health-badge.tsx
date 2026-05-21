import { Badge } from "@/components/ui/badge";
import type { BusinessHealthStatus } from "@/lib/business/business-health";

const HEALTH_LABEL: Record<BusinessHealthStatus, string> = {
  critical: "Crítico",
  attention: "Atenção",
  healthy: "Saudável",
};

const HEALTH_CLASS: Record<BusinessHealthStatus, string> = {
  critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
  attention:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
  healthy:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export function BusinessHealthBadge({
  status,
}: {
  status: BusinessHealthStatus;
}) {
  return (
    <Badge variant="outline" className={HEALTH_CLASS[status]}>
      {HEALTH_LABEL[status]}
    </Badge>
  );
}
