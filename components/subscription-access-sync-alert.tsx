import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { BillingProvider, SubscriptionStatus } from "@/lib/db/schema";
import { getSubscriptionAccessIssue } from "@/lib/subscriptions/derive";

interface SubscriptionAccessSyncAlertProps {
  provider: BillingProvider;
  status: SubscriptionStatus | null | undefined;
  expirationDate: Date | string | null | undefined;
}

export function SubscriptionAccessSyncAlert({
  provider,
  status,
  expirationDate,
}: SubscriptionAccessSyncAlertProps) {
  const issue = getSubscriptionAccessIssue(provider, status, expirationDate);
  if (!issue) return null;

  const detail =
    issue.kind === "expired"
      ? `A assinatura está ativa no Stripe, mas o acesso operacional venceu em ${formatDateInSaoPaulo(issue.expirationDate)}.`
      : "A assinatura está ativa no Stripe, mas o acesso operacional não tem data definida.";

  return (
    <Alert className="border-amber-500/40 bg-amber-500/10">
      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle>Cobrança e acesso divergentes</AlertTitle>
      <AlertDescription className="text-muted-foreground">
        {detail} Confira o último pagamento e os webhooks antes de alterar a
        data manualmente.
      </AlertDescription>
    </Alert>
  );
}
