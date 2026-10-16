import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadgeWithHint } from "@/components/status-badge";
import {
  describeAccessNotice,
  describeBilling,
  type BillingSubscriptionView,
  type LatestPixCharge,
} from "@/lib/subscriptions/access-summary";
import { getAccessBadgeProps } from "@/lib/subscriptions/derive";

export type { BillingSubscriptionView, LatestPixCharge };

interface Props {
  expirationDate: Date | string | null | undefined;
  subscription: BillingSubscriptionView | null;
  latestPixCharge: LatestPixCharge | null;
  now?: Date;
}

/**
 * Two independent facts, side by side: whether the account can use the product
 * (expiration date only) and what the billing side looks like (Stripe status,
 * or the latest Pix charge). The old "status no provedor" badge mixed the two
 * and read "Ativa" for expired Pix customers.
 */
export function AccountBillingStatus({
  expirationDate,
  subscription,
  latestPixCharge,
  now = new Date(),
}: Props) {
  const access = getAccessBadgeProps(expirationDate, now);

  return (
    <div className="space-y-4">
      <AccountAccessNotice
        expirationDate={expirationDate}
        subscription={subscription}
        latestPixCharge={latestPixCharge}
        now={now}
      />
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <Field label="Acesso">
          <StatusBadgeWithHint badge={access} />
        </Field>
        <BillingStatusField
          subscription={subscription}
          latestPixCharge={latestPixCharge}
        />
      </div>
    </div>
  );
}

export function BillingStatusField({
  subscription,
  latestPixCharge,
}: {
  subscription: BillingSubscriptionView | null;
  latestPixCharge: LatestPixCharge | null;
}) {
  const billing = describeBilling(subscription, latestPixCharge);
  return (
    <Field label="Cobrança">
      <p className="text-sm font-medium text-foreground">{billing.title}</p>
      {billing.badge ? (
        <StatusBadgeWithHint badge={billing.badge} className="mt-1" />
      ) : (
        <p className="text-xs text-muted-foreground">{billing.empty}</p>
      )}
    </Field>
  );
}

export function AccountAccessNotice({
  expirationDate,
  subscription,
  latestPixCharge,
  now = new Date(),
}: Props) {
  const notice = describeAccessNotice(
    expirationDate,
    subscription,
    latestPixCharge,
    now,
  );
  if (!notice) return null;

  return (
    <Alert variant="warning">
      <TriangleAlert className="size-4" />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        {notice.detail}
      </AlertDescription>
    </Alert>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
