import {
  CalendarClock,
  History,
  Receipt,
  RotateCw,
  Shield,
  Sparkles,
  User,
} from "lucide-react";
import { ExpirationDateControl } from "@/components/expiration-date-control";
import { PaymentRecoveryCard } from "@/components/payment-recovery-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserSubscriptionDetails } from "@/lib/db/admin-queries";
import type { Payment, PlanType, Subscription } from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import {
  describeUpcomingChange,
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";

const EVENT_TYPE_LABELS: Record<string, string> = {
  subscribed: "Assinatura iniciada",
  renewed: "Assinatura renovada",
  upgraded: "Upgrade de plano",
  downgraded: "Downgrade de plano",
  plan_changed: "Mudança de plano",
  canceled: "Assinatura cancelada",
  reactivated: "Assinatura reativada",
  expired: "Assinatura expirada",
  payment_failed: "Pagamento falhou",
  payment_recovered: "Pagamento recuperado",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  succeeded: "Pago",
  failed: "Falhou",
  pending: "Pendente",
  refunded: "Reembolsado",
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  upgrade: "Upgrade",
  downgrade: "Downgrade",
  plan_change: "Mudança de plano",
};

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(d);
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function planNameOrDash(planType: PlanType | null | undefined): string {
  if (!planType) return "—";
  return PLAN_DEFINITIONS[planType]?.name ?? planType;
}

function paymentStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "succeeded") return "default";
  if (status === "failed") return "destructive";
  if (status === "refunded") return "outline";
  return "secondary";
}

function computeRecoverableInvoice(
  activeSubscription: Subscription | null,
  payments: Payment[],
): (Payment & { stripeInvoiceId: string }) | null {
  if (!activeSubscription) return null;
  if (
    activeSubscription.status !== "past_due" &&
    activeSubscription.status !== "unpaid"
  ) {
    return null;
  }
  const candidate = payments.find(
    (p): p is Payment & { stripeInvoiceId: string } =>
      p.status === "failed" &&
      p.stripeInvoiceId !== null &&
      p.subscriptionId === activeSubscription.id,
  );
  return candidate ?? null;
}

export function UserSubscriptionPanel({
  data,
  showProfileCard = true,
}: {
  data: UserSubscriptionDetails;
  showProfileCard?: boolean;
}) {
  const {
    user,
    activeSubscription,
    pendingPlanChange,
    subscriptionHistory,
    payments,
    events,
  } = data;

  const badge = getStatusBadgeProps(
    activeSubscription?.status ?? null,
    user.expirationDate,
    activeSubscription?.cancelAtPeriodEnd ?? false,
    activeSubscription?.currentPeriodEnd ?? null,
  );
  const upcoming = describeUpcomingChange(
    activeSubscription
      ? {
          status: activeSubscription.status,
          planType: activeSubscription.planType,
          currentPeriodEnd: activeSubscription.currentPeriodEnd,
          cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
        }
      : null,
    pendingPlanChange,
  );
  const isTrialing = activeSubscription?.status === "trialing";
  const recoverableInvoice = computeRecoverableInvoice(
    activeSubscription,
    payments,
  );

  return (
    <div className="space-y-6">
      {showProfileCard && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Usuário & Cliente Stripe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Email" value={user.email} mono={false} />
              <Row label="Nome" value={user.name ?? "—"} mono={false} />
              <Row label="Telefone" value={user.phone ?? "—"} />
              <Row label="Idioma" value={user.locale ?? "—"} />
              <Row label="Provedor de auth" value={user.authProvider} />
              <Row
                label="Créditos"
                value={new Intl.NumberFormat("pt-BR").format(user.credits)}
              />
              <Row label="ID interno" value={user.id} mono />
              <Row
                label="Stripe Customer ID"
                value={user.stripeCustomerId ?? "—"}
                mono
              />
            </dl>

            <div className="mt-6">
              <ExpirationDateControl
                userId={user.id}
                expirationDate={user.expirationDate}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Status atual da assinatura
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!activeSubscription ? (
            <p className="py-4 text-sm text-muted-foreground">
              Nenhuma assinatura ativa registrada para este usuário.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Plano
                  </p>
                  <p className="text-base font-semibold">
                    {formatPlanLabel(activeSubscription.planType)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Status
                  </p>
                  <div className="mt-0.5 flex flex-col gap-1">
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
                {activeSubscription.cancelAtPeriodEnd && (
                  <Badge variant="secondary" className="self-center">
                    Cancelamento agendado
                  </Badge>
                )}
              </div>

              {isTrialing && (
                <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 size-4 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">
                        Em período de teste até{" "}
                        {formatDate(activeSubscription.currentPeriodEnd)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Plano agendado para após o trial:{" "}
                        <span className="font-semibold text-foreground">
                          {formatPlanLabel(activeSubscription.planType)}
                        </span>
                      </p>
                      {pendingPlanChange && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          (substituído por{" "}
                          <span className="font-semibold text-foreground">
                            {formatPlanLabel(pendingPlanChange.newPlanType)}
                          </span>{" "}
                          em {formatDate(pendingPlanChange.effectiveDate)})
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!isTrialing && upcoming && (
                <div className="rounded-md border border-border bg-muted/40 p-4">
                  <div className="flex items-start gap-2">
                    <CalendarClock className="mt-0.5 size-4 text-primary" />
                    <div>
                      <p className="font-medium">{upcoming.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {upcoming.detail}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Row
                  label="Período atual (início)"
                  value={formatDateTime(activeSubscription.currentPeriodStart)}
                />
                <Row
                  label="Período atual (fim)"
                  value={formatDateTime(activeSubscription.currentPeriodEnd)}
                />
                <Row
                  label="Compromisso"
                  value={`${activeSubscription.commitmentMonths} ${
                    activeSubscription.commitmentMonths === 1 ? "mês" : "meses"
                  }`}
                />
                <Row
                  label="Compromisso até"
                  value={formatDate(activeSubscription.commitmentEndDate)}
                />
                <Row
                  label="Cancelada em"
                  value={formatDateTime(activeSubscription.canceledAt)}
                />
                <Row
                  label="Encerrada em"
                  value={formatDateTime(activeSubscription.endedAt)}
                />
                <Row
                  label="Atualizada em"
                  value={formatDateTime(activeSubscription.updatedAt)}
                />
                <Row
                  label="Criada em"
                  value={formatDateTime(activeSubscription.createdAt)}
                />
                <Row
                  label="Stripe Subscription ID"
                  value={activeSubscription.stripeSubscriptionId}
                  mono
                />
                <Row
                  label="Stripe Price ID"
                  value={activeSubscription.stripePriceId}
                  mono
                />
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      {recoverableInvoice &&
        (activeSubscription?.status === "past_due" ||
          activeSubscription?.status === "unpaid") && (
          <PaymentRecoveryCard
            userId={user.id}
            invoiceId={recoverableInvoice.stripeInvoiceId}
            amountCents={recoverableInvoice.amount}
            currency={recoverableInvoice.currency}
            failureReason={recoverableInvoice.failureReason}
            failedAt={recoverableInvoice.createdAt}
            subscriptionStatus={activeSubscription.status}
          />
        )}

      {pendingPlanChange && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5" />
              Mudança de plano agendada
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-4 text-sm">
                <p className="font-medium text-foreground">
                  {planNameOrDash(pendingPlanChange.currentPlanType)} →{" "}
                  <span className="text-primary">
                    {planNameOrDash(pendingPlanChange.newPlanType)}
                  </span>
                </p>
                <p className="mt-1 text-muted-foreground">
                  Efetiva em {formatDate(pendingPlanChange.effectiveDate)}
                </p>
              </div>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Row
                  label="Tipo"
                  value={
                    CHANGE_TYPE_LABELS[pendingPlanChange.changeType] ??
                    pendingPlanChange.changeType
                  }
                />
                <Row label="Status" value={pendingPlanChange.status} />
                <Row
                  label="Novo Stripe Price ID"
                  value={pendingPlanChange.newStripePriceId}
                  mono
                />
                <Row
                  label="Subscription ID (interno)"
                  value={pendingPlanChange.subscriptionId}
                  mono
                />
                <Row
                  label="Criada em"
                  value={formatDateTime(pendingPlanChange.createdAt)}
                />
                <Row
                  label="Atualizada em"
                  value={formatDateTime(pendingPlanChange.updatedAt)}
                />
              </dl>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Histórico de eventos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum evento registrado
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                      </p>
                      {(event.fromPlan || event.toPlan) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {event.fromPlan
                            ? planNameOrDash(event.fromPlan)
                            : "—"}{" "}
                          → {event.toPlan ? planNameOrDash(event.toPlan) : "—"}
                        </p>
                      )}
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </div>
                  {event.metadata && Object.keys(event.metadata).length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Metadata
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Histórico de pagamentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhum pagamento registrado
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pago em</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Stripe Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(p.paidAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(p.createdAt)}
                      </TableCell>
                      <TableCell>{planNameOrDash(p.planType)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatMoney(p.amount, p.currency)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge
                            variant={paymentStatusVariant(p.status)}
                            className="w-fit"
                          >
                            {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                          </Badge>
                          {p.failureReason && (
                            <span className="text-[11px] text-destructive">
                              {p.failureReason}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                        {p.description ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate font-mono text-[11px] text-muted-foreground">
                        {p.stripeInvoiceId ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCw className="h-5 w-5" />
            Histórico de assinaturas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subscriptionHistory.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nenhuma assinatura registrada
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Criada</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Encerrada</TableHead>
                    <TableHead>Stripe Subscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptionHistory.map((s) => (
                    <TableRow
                      key={s.id}
                      className={
                        activeSubscription?.id === s.id ? "bg-muted/40" : ""
                      }
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(s.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {planNameOrDash(s.planType)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(s.currentPeriodStart)} —{" "}
                        {formatDate(s.currentPeriodEnd)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(s.endedAt)}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-[11px] text-muted-foreground">
                        {s.stripeSubscriptionId}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "break-all font-mono text-[12px] text-foreground/90"
            : "break-words text-sm font-medium text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}
