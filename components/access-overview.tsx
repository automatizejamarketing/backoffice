import { CalendarClock, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  AccountAccessNotice,
  BillingStatusField,
  type BillingSubscriptionView,
  type LatestPixCharge,
} from "@/components/account-billing-status";
import { ExpirationDateDialog } from "@/components/expiration-date-dialog";
import { StatusBadgeWithHint } from "@/components/status-badge";
import type { PendingPlanChange } from "@/lib/db/schema";
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import {
  describeUpcomingChange,
  getAccessBadgeProps,
  getAccessState,
} from "@/lib/subscriptions/derive";

interface Props {
  userId: string;
  expirationDate: Date | string | null;
  subscription:
    | (BillingSubscriptionView & { currentPeriodEnd: Date | string | null })
    | null;
  pendingPlanChange: PendingPlanChange | null;
  latestPixCharge: LatestPixCharge | null;
}

/**
 * The one fact an operator needs first: until when this account works. The
 * date is the headline; billing is context underneath it.
 */
export function AccessOverview({
  userId,
  expirationDate,
  subscription,
  pendingPlanChange,
  latestPixCharge,
}: Props) {
  const access = getAccessState(expirationDate);
  const badge = getAccessBadgeProps(expirationDate);
  const upcoming = describeUpcomingChange(subscription, pendingPlanChange);

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <AccountAccessNotice
          expirationDate={expirationDate}
          subscription={subscription}
          latestPixCharge={latestPixCharge}
        />

        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Acesso à plataforma até
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                {access.kind === "missing"
                  ? "Sem data"
                  : formatNumericDateInSaoPaulo(access.expirationDate)}
              </p>
              <StatusBadgeWithHint badge={badge} className="mt-2" />
            </div>
            <BillingStatusField
              subscription={subscription}
              latestPixCharge={latestPixCharge}
            />
          </div>
          <ExpirationDateDialog userId={userId} expirationDate={expirationDate} />
        </div>

        {upcoming ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
            {upcoming.kind === "trial_to_paid" ? (
              <Sparkles className="mt-0.5 size-4 text-primary" />
            ) : (
              <CalendarClock className="mt-0.5 size-4 text-primary" />
            )}
            <div>
              <p className="text-sm font-medium">{upcoming.label}</p>
              <p className="text-xs text-muted-foreground">{upcoming.detail}</p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
