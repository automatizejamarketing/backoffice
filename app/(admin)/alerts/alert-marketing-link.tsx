import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildMarketingMetricsHref } from "../marketing/utils/marketing-deep-link";
import type { PlaybookAlertDashboardRow } from "@/lib/db/playbook-alert-dashboard-queries";

export function AlertMarketingLink({
  row,
}: {
  row: PlaybookAlertDashboardRow;
}) {
  const accountId = row.metrics?.accountId;
  return (
    <Button asChild variant="ghost" size="sm">
      <Link
        href={buildMarketingMetricsHref({
          userId: row.userId,
          userEmail: row.userEmail,
          accountId: typeof accountId === "string" ? accountId : null,
        })}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Marketing (abre em outra aba)"
      >
        Marketing <ExternalLink className="size-3.5" />
      </Link>
    </Button>
  );
}
