import Link from "next/link";
import { ArrowRight, CalendarClock, CreditCard, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PendingPlanChange, Subscription } from "@/lib/db/schema";
import {
  describeUpcomingChange,
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";

interface Props {
  userId: string;
  subscription: Subscription | null;
  pendingPlanChange: PendingPlanChange | null;
  expirationDate: Date | string | null;
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
  }).format(d);
}

export function SubscriptionSummaryCard({
  userId,
  subscription,
  pendingPlanChange,
  expirationDate,
}: Props) {
  const badge = getStatusBadgeProps(
    subscription?.status ?? null,
    expirationDate,
    subscription?.cancelAtPeriodEnd ?? false,
    subscription?.currentPeriodEnd ?? null,
  );
  const upcoming = describeUpcomingChange(
    subscription
      ? {
          status: subscription.status,
          planType: subscription.planType,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        }
      : null,
    pendingPlanChange,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4" />
          Assinatura & Pagamentos
        </CardTitle>
        <Link
          href={`/subscriptions/${userId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Ver detalhes
          <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {!subscription ? (
          <div className="text-sm text-muted-foreground">
            Sem assinatura registrada para este usuário.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Plano atual
                </p>
                <p className="text-base font-semibold text-foreground">
                  {formatPlanLabel(subscription.planType)}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <Badge variant={badge.variant} className="w-fit">
                  {badge.label}
                </Badge>
                {badge.hint && (
                  <span className="text-[11px] text-muted-foreground">
                    {badge.hint}
                  </span>
                )}
              </div>
            </div>

            {upcoming && (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <div className="flex items-start gap-2">
                  {upcoming.kind === "trial_to_paid" ? (
                    <Sparkles className="size-4 text-primary mt-0.5" />
                  ) : (
                    <CalendarClock className="size-4 text-primary mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {upcoming.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {upcoming.detail}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  Próxima cobrança
                </dt>
                <dd className="font-medium text-foreground">
                  {formatDate(subscription.currentPeriodEnd)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Compromisso</dt>
                <dd className="font-medium text-foreground">
                  {subscription.commitmentMonths} {subscription.commitmentMonths === 1 ? "mês" : "meses"}
                  {subscription.commitmentEndDate && (
                    <span className="text-muted-foreground">
                      {" "}
                      (até {formatDate(subscription.commitmentEndDate)})
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Acesso até</dt>
                <dd className="font-medium text-foreground">
                  {formatDate(expirationDate)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Stripe Subscription
                </dt>
                <dd className="font-mono text-[11px] text-foreground/80 break-all">
                  {subscription.stripeSubscriptionId}
                </dd>
              </div>
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}
