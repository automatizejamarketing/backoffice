import { CalendarClock, CreditCard, History, Receipt, RotateCw, Shield } from "lucide-react";
import { AccountHistoryTimeline } from "@/components/account-history-timeline";
import { ExpirationDateControl } from "@/components/expiration-date-control";
import { SubscriptionAccessSyncAlert } from "@/components/subscription-access-sync-alert";
import {
  MercadoPagoPixActions,
  type PixLinkView,
} from "@/components/mercadopago-pix-actions";
import { ManualPaymentDialog } from "@/components/manual-payment-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UserSubscriptionDetails } from "@/lib/db/admin-queries";
import type {
  Payment,
  PendingPlanChange,
  PlanType,
  Subscription,
  SubscriptionEvent,
  User,
} from "@/lib/db/schema";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { getPixRenewalDisabledReason } from "@/lib/backoffice/pix-renewal-policy";
import { normalizePixInitPoint } from "@/lib/backoffice/pix-link-view";
import {
  describeUpcomingChange,
  formatPlanLabel,
  getStatusBadgeProps,
  type StatusBadgeProps,
} from "@/lib/subscriptions/derive";
import {
  formatDateInSaoPaulo,
  formatDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";

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

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe/cartão",
  mercadopago: "Mercado Pago Pix",
  manual: "Manual",
};

function formatDate(value: Date | string | null | undefined): string {
  return formatDateInSaoPaulo(value);
}

function formatDateTime(value: Date | string | null | undefined): string {
  return formatDateTimeInSaoPaulo(value);
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
    (payment): payment is Payment & { stripeInvoiceId: string } =>
      payment.status === "failed" &&
      payment.stripeInvoiceId !== null &&
      payment.subscriptionId === activeSubscription.id,
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
    mercadopagoPaymentLinks,
    events,
    accountHistory,
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
  const pixDisabledReason = getPixRenewalDisabledReason(activeSubscription);
  const pixLinks: PixLinkView[] = mercadopagoPaymentLinks.map((link) => ({
    id: link.id,
    planType: link.planType,
    amount: link.amount,
    currency: link.currency,
    preferenceId: link.preferenceId,
    ...normalizePixInitPoint(link.initPoint),
    mercadopagoPaymentId: link.mercadopagoPaymentId,
    status: link.status,
    source: link.source,
    adminEmail: link.adminEmail,
    expiresAt: link.expiresAt.toISOString(),
    createdAt: link.createdAt.toISOString(),
  }));
  const hasStripe =
    Boolean(user.stripeCustomerId) ||
    subscriptionHistory.some(
      (subscription) => subscription.provider === "stripe",
    ) ||
    payments.some((payment) => payment.provider === "stripe");

  return (
    <div className="space-y-6">
      {showProfileCard ? (
        <div>
          <p className="text-lg font-semibold">{user.email}</p>
          {user.name ? (
            <p className="text-sm text-muted-foreground">{user.name}</p>
          ) : null}
        </div>
      ) : null}

      <Tabs defaultValue="access" className="gap-0">
        <TabsList
          variant="line"
          className="h-auto w-full justify-start rounded-none border-b bg-transparent p-0"
        >
          <TabsTrigger
            className="h-auto rounded-none px-4 py-2.5 text-sm after:bottom-0 data-[state=active]:bg-transparent dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent"
            value="access"
          >
            <Receipt className="size-4" />
            Acesso e pagamentos
          </TabsTrigger>
          <TabsTrigger
            className="h-auto rounded-none px-4 py-2.5 text-sm after:bottom-0 data-[state=active]:bg-transparent dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent"
            value="stripe"
          >
            <CreditCard className="size-4" />
            Stripe
            {hasStripe ? null : (
              <span className="font-normal text-muted-foreground">
                · sem dados
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="access" className="mt-6 space-y-6 text-sm">
          <PaymentsCard payments={payments} />

          <ExpirationDateControl
            userId={user.id}
            expirationDate={user.expirationDate}
          />

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Histórico da conta</h3>
            <AccountHistoryTimeline items={accountHistory} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Plano atual
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ManualPaymentDialog
                userId={user.id}
                currentPlanType={activeSubscription?.planType ?? null}
                currentExpiration={user.expirationDate}
                disabledReason={
                  pixDisabledReason
                    ? "Este usuário possui assinatura Stripe ativa."
                    : null
                }
              />
              {!activeSubscription ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma assinatura ativa. O acesso vale pela data de
                  expiração acima.
                </p>
              ) : (
                <CurrentPlanSnapshot
                  subscription={activeSubscription}
                  badge={badge}
                  isTrialing={isTrialing}
                  upcoming={upcoming}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Mercado Pago Pix
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MercadoPagoPixActions
                userId={user.id}
                currentPlanType={activeSubscription?.planType ?? null}
                initialLinks={pixLinks}
                disabledReason={pixDisabledReason}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stripe" className="mt-6 space-y-6 text-sm">
          {!hasStripe ? (
            <p className="text-sm text-muted-foreground">
              Este usuário não tem customer, assinatura nem pagamento Stripe.
            </p>
          ) : (
            <StripeBillingDetails
              user={user}
              activeSubscription={activeSubscription}
              pendingPlanChange={pendingPlanChange}
              subscriptionHistory={subscriptionHistory}
              events={events}
              recoverableInvoice={recoverableInvoice}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CurrentPlanSnapshot({
  subscription,
  badge,
  isTrialing,
  upcoming,
}: {
  subscription: Subscription;
  badge: StatusBadgeProps;
  isTrialing: boolean;
  upcoming: { label: string; detail: string } | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Plano
          </p>
          <p className="text-base font-semibold">
            {formatPlanLabel(subscription.planType)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Provedor
          </p>
          <p className="text-sm font-medium">
            {PROVIDER_LABELS[subscription.provider] ?? subscription.provider}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Status no provedor
          </p>
          <div className="mt-0.5 flex flex-col gap-1">
            <Badge variant={badge.variant} className="w-fit">
              {badge.label}
            </Badge>
            {badge.hint ? (
              <span className="text-[11px] text-muted-foreground">
                {badge.hint}
              </span>
            ) : null}
          </div>
        </div>
        {subscription.cancelAtPeriodEnd ? (
          <Badge variant="secondary" className="self-center">
            Cancelamento agendado
          </Badge>
        ) : null}
      </div>

      {isTrialing ? (
        <p className="text-sm text-muted-foreground">
          Em trial até {formatDate(subscription.currentPeriodEnd)}. Depois segue
          no plano {formatPlanLabel(subscription.planType)}.
        </p>
      ) : null}

      {!isTrialing && upcoming ? (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-start gap-2">
            <CalendarClock className="mt-0.5 size-4 text-primary" />
            <div>
              <p className="text-sm font-medium">{upcoming.label}</p>
              <p className="text-xs text-muted-foreground">{upcoming.detail}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PaymentsCard({ payments }: { payments: Payment[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          Pagamentos
          <span className="font-normal text-muted-foreground">
            · {payments.length}
          </span>
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
                  <TableHead>Plano</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provedor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDateTime(payment.paidAt ?? payment.createdAt)}
                    </TableCell>
                    <TableCell>{planNameOrDash(payment.planType)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatMoney(payment.amount, payment.currency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          variant={paymentStatusVariant(payment.status)}
                          className="w-fit"
                        >
                          {PAYMENT_STATUS_LABELS[payment.status] ??
                            payment.status}
                        </Badge>
                        {payment.failureReason ? (
                          <span className="text-[11px] text-destructive">
                            {payment.failureReason}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {PROVIDER_LABELS[payment.provider] ?? payment.provider}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StripeBillingDetails({
  user,
  activeSubscription,
  pendingPlanChange,
  subscriptionHistory,
  events,
  recoverableInvoice,
}: {
  user: User;
  activeSubscription: Subscription | null;
  pendingPlanChange: PendingPlanChange | null;
  subscriptionHistory: Subscription[];
  events: SubscriptionEvent[];
  recoverableInvoice: (Payment & { stripeInvoiceId: string }) | null;
}) {
  const stripeSubscription =
    activeSubscription?.provider === "stripe" ? activeSubscription : null;

  return (
    <>
      {recoverableInvoice &&
      (activeSubscription?.status === "past_due" ||
        activeSubscription?.status === "unpaid") ? (
        <PaymentRecoveryCard
          userId={user.id}
          invoiceId={recoverableInvoice.stripeInvoiceId}
          amountCents={recoverableInvoice.amount}
          currency={recoverableInvoice.currency}
          failureReason={recoverableInvoice.failureReason}
          failedAt={recoverableInvoice.createdAt}
          subscriptionStatus={activeSubscription.status}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Dados Stripe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {stripeSubscription ? (
            <SubscriptionAccessSyncAlert
              provider={stripeSubscription.provider}
              status={stripeSubscription.status}
              expirationDate={user.expirationDate}
            />
          ) : null}
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Row label="Customer ID" value={user.stripeCustomerId} mono />
            <Row
              label="Subscription ID"
              value={stripeSubscription?.stripeSubscriptionId}
              mono
            />
            <Row
              label="Price ID"
              value={stripeSubscription?.stripePriceId}
              mono
            />
            <Row
              label="Ciclo (início)"
              value={formatDateTime(stripeSubscription?.currentPeriodStart)}
            />
            <Row
              label="Ciclo (fim)"
              value={formatDateTime(stripeSubscription?.currentPeriodEnd)}
            />
            <Row
              label="Cancelada em"
              value={formatDateTime(stripeSubscription?.canceledAt)}
            />
            <Row
              label="Encerrada em"
              value={formatDateTime(stripeSubscription?.endedAt)}
            />
            {stripeSubscription && stripeSubscription.commitmentMonths > 1 ? (
              <>
                <Row
                  label="Compromisso"
                  value={`${stripeSubscription.commitmentMonths} meses`}
                />
                <Row
                  label="Compromisso até"
                  value={formatDate(stripeSubscription.commitmentEndDate)}
                />
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {pendingPlanChange ? (
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
              </dl>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                      {event.fromPlan || event.toPlan ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {event.fromPlan
                            ? planNameOrDash(event.fromPlan)
                            : "—"}{" "}
                          → {event.toPlan ? planNameOrDash(event.toPlan) : "—"}
                        </p>
                      ) : null}
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </span>
                  </div>
                  {event.metadata && Object.keys(event.metadata).length > 0 ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Metadata
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                        {JSON.stringify(event.metadata, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
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
                    <TableHead>Provedor</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Encerrada</TableHead>
                    <TableHead>Stripe Subscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptionHistory.map((subscription) => (
                    <TableRow
                      key={subscription.id}
                      className={
                        activeSubscription?.id === subscription.id
                          ? "bg-muted/40"
                          : ""
                      }
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(subscription.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {planNameOrDash(subscription.planType)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {subscription.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {PROVIDER_LABELS[subscription.provider] ??
                          subscription.provider}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(subscription.currentPeriodStart)} —{" "}
                        {formatDate(subscription.currentPeriodEnd)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(subscription.endedAt)}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-[11px] text-muted-foreground">
                        {subscription.stripeSubscriptionId ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const displayValue = value ?? "—";
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
        {displayValue}
      </dd>
    </div>
  );
}
