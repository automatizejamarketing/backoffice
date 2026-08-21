"use client";

import { useEffect, useState } from "react";
import type { UserWithUsage } from "@/lib/db/admin-queries";
import type { BillingProvider } from "@/lib/db/schema";
import { formatCalendarDayInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";
import { Columns3 } from "lucide-react";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { canManageUserActivation } from "@/lib/backoffice/user-activation-policy";
import { cn } from "@/lib/utils";
import { UsersTableShell } from "./users-table-shell";
import { UserActivationActions } from "./user-activation-actions";

const COLUMN_STORAGE_KEY = "automatize-backoffice.users-columns.v1";

const OPTIONAL_COLUMNS = [
  { id: "company", label: "Empresa" },
  { id: "phone", label: "Telefone" },
  { id: "plan", label: "Plano" },
  { id: "status", label: "Status" },
  { id: "expiration", label: "Expiração" },
  { id: "campaign", label: "Campanha" },
  { id: "performance", label: "Performance 7d" },
  { id: "marketing", label: "Marketing" },
  { id: "consultant", label: "Consultor" },
  { id: "posts", label: "Posts" },
  { id: "requests", label: "Requisições IA" },
  { id: "tokens", label: "Tokens" },
  { id: "cost", label: "Custo" },
] as const;

type OptionalColumnId = (typeof OPTIONAL_COLUMNS)[number]["id"];

const ALL_OPTIONAL_COLUMNS = OPTIONAL_COLUMNS.map((column) => column.id);
const HIDDEN_COLUMN_CLASSES: Record<OptionalColumnId, string> = {
  company: "[&_[data-column='company']]:hidden",
  phone: "[&_[data-column='phone']]:hidden",
  plan: "[&_[data-column='plan']]:hidden",
  status: "[&_[data-column='status']]:hidden",
  expiration: "[&_[data-column='expiration']]:hidden",
  campaign: "[&_[data-column='campaign']]:hidden",
  performance: "[&_[data-column='performance']]:hidden",
  marketing: "[&_[data-column='marketing']]:hidden",
  consultant: "[&_[data-column='consultant']]:hidden",
  posts: "[&_[data-column='posts']]:hidden",
  requests: "[&_[data-column='requests']]:hidden",
  tokens: "[&_[data-column='tokens']]:hidden",
  cost: "[&_[data-column='cost']]:hidden",
};

const PROVIDER_LABELS: Record<BillingProvider, string> = {
  stripe: "Cartão",
  mercadopago: "Pix",
  manual: "Manual",
  vindi: "Vindi",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatExpirationDate(value: Date | string): string {
  return formatCalendarDayInSaoPaulo(value);
}

function formatExpirationHint(daysUntilRenewal: number | null): string | null {
  if (daysUntilRenewal === null) return null;
  if (daysUntilRenewal < 0) {
    return `Expirou há ${Math.abs(daysUntilRenewal)}d`;
  }
  if (daysUntilRenewal === 0) return "Vence hoje";
  return `Em ${daysUntilRenewal}d`;
}

type UsersTableProps = {
  users: UserWithUsage[];
  search: string;
  canManageBilling: boolean;
};

export function UsersTable({
  users,
  search,
  canManageBilling,
}: UsersTableProps) {
  const [rows, setRows] = useState(users);
  const [visibleColumns, setVisibleColumns] = useState<OptionalColumnId[]>(
    ALL_OPTIONAL_COLUMNS,
  );

  useEffect(() => {
    setRows(users);
  }, [users]);

  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(COLUMN_STORAGE_KEY) ?? "null",
      ) as unknown;
      if (!Array.isArray(stored)) return;
      const validColumns = ALL_OPTIONAL_COLUMNS.filter((column) =>
        stored.includes(column),
      );
      setVisibleColumns(validColumns);
    } catch {
      localStorage.removeItem(COLUMN_STORAGE_KEY);
    }
  }, []);

  function setColumnVisible(column: OptionalColumnId, visible: boolean) {
    setVisibleColumns((current) => {
      const next = visible
        ? ALL_OPTIONAL_COLUMNS.filter(
            (candidate) =>
              candidate === column || current.includes(candidate),
          )
        : current.filter((candidate) => candidate !== column);
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function showAllColumns() {
    localStorage.removeItem(COLUMN_STORAGE_KEY);
    setVisibleColumns(ALL_OPTIONAL_COLUMNS);
  }

  const hiddenColumnClasses = ALL_OPTIONAL_COLUMNS.filter(
    (column) => !visibleColumns.includes(column),
  ).map((column) => HIDDEN_COLUMN_CLASSES[column]);

  return (
    <UsersTableShell>
      <div className="mb-2 flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">
          {visibleColumns.length + 2} colunas visíveis
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Columns3 className="size-3.5" />
              Colunas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Mostrar na tabela</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {OPTIONAL_COLUMNS.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={visibleColumns.includes(column.id)}
                onCheckedChange={(checked) =>
                  setColumnVisible(column.id, checked === true)
                }
                onSelect={(event) => event.preventDefault()}
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start text-xs"
              onClick={showAllColumns}
              disabled={visibleColumns.length === ALL_OPTIONAL_COLUMNS.length}
            >
              Mostrar todas
            </Button>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        className={cn(
          "overflow-x-auto rounded-lg border border-border bg-card",
          hiddenColumnClasses,
        )}
      >
        <table className="w-full min-w-max">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Usuário
              </th>
              <th
                data-column="company"
                className="w-[320px] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Empresa
              </th>
              <th data-column="phone" className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Telefone
              </th>
              <th data-column="plan" className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Plano
              </th>
              <th data-column="status" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th data-column="expiration" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Expiração
              </th>
              <th data-column="campaign" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Campanha
              </th>
              <th data-column="performance" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Performance 7d
              </th>
              <th data-column="marketing" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Marketing
              </th>
              <th data-column="consultant" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Consultor
              </th>
              <th data-column="posts" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Posts
              </th>
              <th data-column="requests" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Requisições IA
              </th>
              <th data-column="tokens" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Tokens
              </th>
              <th data-column="cost" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Custo
              </th>
              <th className="w-14 px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  {search
                    ? `Nenhum usuário encontrado para "${search}"`
                    : "Nenhum usuário encontrado"}
                </td>
              </tr>
            ) : (
              rows.map((user) => {
                const sub = user.activeSubscription;
                const badge = getStatusBadgeProps(
                  sub?.status ?? null,
                  user.expirationDate,
                  sub?.cancelAtPeriodEnd ?? false,
                  sub?.currentPeriodEnd ?? null,
                );
                const phoneFormatted = formatBrazilianPhone(user.phone);
                const whatsappUrl = getWhatsAppUrl(user.phone);
                const expirationHint = formatExpirationHint(
                  user.renewalAlert?.daysUntilRenewal ?? null,
                );
                const providerLabel = sub?.provider
                  ? (PROVIDER_LABELS[sub.provider] ?? sub.provider)
                  : null;

                return (
                  <tr
                    key={user.id}
                    data-user-id={user.id}
                    data-user-email={user.email}
                    className="group cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.image_url ? (
                          <img
                            src={user.image_url}
                            alt={user.email}
                            className="h-8 w-8 rounded-full"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                            {user.email.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="block text-sm font-medium text-foreground hover:underline">
                            {user.email}
                          </span>
                          {canManageUserActivation(user) ? (
                            <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300">
                              Ativação pendente
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td data-column="company" className="w-[320px] px-4 py-3">
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        {user.companyName ? (
                          <span
                            className="max-w-[300px] truncate whitespace-nowrap text-sm text-foreground/80"
                            title={user.companyName}
                          >
                            {user.companyName}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-sm text-muted-foreground/60">
                            —
                          </span>
                        )}
                        <Badge
                          variant={
                            user.onboardingCompleted ? "secondary" : "outline"
                          }
                          className="w-fit whitespace-nowrap text-xs"
                        >
                          {user.onboardingCompleted
                            ? "Integrado"
                            : "Não integrado"}
                        </Badge>
                      </div>
                    </td>
                    <td
                      data-column="phone"
                      className="whitespace-nowrap px-4 py-3"
                      data-user-row-ignore
                    >
                      {phoneFormatted ? (
                        whatsappUrl ? (
                          <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground/80 hover:text-[#25D366] hover:underline"
                            aria-label={`Abrir conversa no WhatsApp com ${phoneFormatted}`}
                          >
                            <WhatsAppIcon className="size-3.5" />
                            {phoneFormatted}
                          </a>
                        ) : (
                          <span className="text-sm text-foreground/80">
                            {phoneFormatted}
                          </span>
                        )
                      ) : (
                        <span className="whitespace-nowrap text-sm text-muted-foreground/60">
                          —
                        </span>
                      )}
                    </td>
                    <td data-column="plan" className="whitespace-nowrap px-4 py-3">
                      {sub ? (
                        <span className="whitespace-nowrap text-sm text-foreground/80">
                          {formatPlanLabel(sub.planType)}
                          {providerLabel ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              · {providerLabel}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap text-sm text-muted-foreground/60">
                          —
                        </span>
                      )}
                    </td>
                    <td data-column="status" className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <Badge
                          variant={badge.variant}
                          className="w-fit text-xs"
                        >
                          {badge.label}
                        </Badge>
                        {badge.hint && (
                          <span className="text-[11px] text-muted-foreground">
                            {badge.hint}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-column="expiration" className="px-4 py-3">
                      {user.expirationDate ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="whitespace-nowrap text-sm font-medium text-foreground/80">
                            {formatExpirationDate(user.expirationDate)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {user.renewalAlert ? (
                              <Badge
                                variant="outline"
                                className={
                                  user.renewalAlert.severity === "critical"
                                    ? "w-fit border-red-200 bg-red-50 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
                                    : "w-fit border-amber-200 bg-amber-50 text-xs text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
                                }
                              >
                                {user.renewalAlert.label}
                              </Badge>
                            ) : null}
                            {expirationHint ? (
                              <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                                {expirationHint}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="whitespace-nowrap text-xs text-muted-foreground/60">
                          Não definida
                        </span>
                      )}
                    </td>
                    <td data-column="campaign" className="px-4 py-3">
                      {user.hasActiveManagedCampaign ? (
                        <Badge variant="default" className="w-fit text-xs">
                          Campanha ativa
                        </Badge>
                      ) : user.managedCampaignCheckedAt ? (
                        <Badge variant="outline" className="w-fit text-xs">
                          Sem campanha ativa
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="w-fit text-xs">
                          Não verificado
                        </Badge>
                      )}
                    </td>
                    <td data-column="performance" className="px-4 py-3">
                      {user.performanceDrop.hasDrop ? (
                        <Badge
                          variant="outline"
                          className={
                            user.performanceDrop.highestSeverity === "critical"
                              ? "w-fit border-red-200 bg-red-50 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
                              : "w-fit border-amber-200 bg-amber-50 text-xs text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
                          }
                        >
                          {user.performanceDrop.highestSeverity === "critical"
                            ? "Queda crítica"
                            : "Queda 7d"}
                        </Badge>
                      ) : user.performanceDrop.checkFailed ? (
                        <Badge
                          variant="outline"
                          className="w-fit border-orange-200 bg-orange-50 text-xs text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300"
                        >
                          Erro na checagem
                        </Badge>
                      ) : user.performanceDrop.wasChecked ? (
                        <Badge variant="outline" className="w-fit text-xs">
                          Sem queda
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="w-fit text-xs">
                          Não verificado
                        </Badge>
                      )}
                    </td>
                    <td data-column="marketing" className="px-4 py-3">
                      {user.hasMetaBusinessAccount ? (
                        <div className="inline-flex flex-col items-start gap-1">
                          <Badge variant="default" className="w-fit text-xs">
                            Meta conectado
                          </Badge>
                          {user.metaAccountName && (
                            <span className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                              {user.metaAccountName}
                            </span>
                          )}
                        </div>
                      ) : (
                        <Badge variant="outline" className="w-fit text-xs">
                          Sem Meta
                        </Badge>
                      )}
                    </td>
                    <td data-column="consultant" className="px-4 py-3">
                      {user.assignedConsultantEmail ? (
                        <div className="flex max-w-[220px] flex-col">
                          <span className="truncate text-sm text-foreground/80">
                            {user.assignedConsultantName ??
                              user.assignedConsultantEmail}
                          </span>
                          {user.assignedConsultantName && (
                            <span className="truncate text-xs text-muted-foreground">
                              {user.assignedConsultantEmail}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="whitespace-nowrap text-sm text-muted-foreground/60">
                          —
                        </span>
                      )}
                    </td>
                    <td data-column="posts" className="px-4 py-3 text-right text-sm text-foreground/80">
                      {formatNumber(user.postCount)}
                    </td>
                    <td data-column="requests" className="px-4 py-3 text-right text-sm text-foreground/80">
                      {formatNumber(user.requestCount)}
                    </td>
                    <td data-column="tokens" className="px-4 py-3 text-right text-sm text-foreground/80">
                      {formatNumber(user.totalTokens)}
                    </td>
                    <td data-column="cost" className="px-4 py-3 text-right text-sm font-medium text-foreground">
                      {formatCurrency(user.totalCost)}
                    </td>
                    <td
                      data-user-row-ignore
                      className="px-3 py-3 text-right"
                    >
                      <UserActivationActions
                        userId={user.id}
                        userEmail={user.email}
                        userPhone={user.phone}
                        expirationDate={user.expirationDate}
                        activationAvailable={canManageUserActivation(user)}
                        activeSubscription={user.activeSubscription}
                        canManageBilling={canManageBilling}
                        onActivated={(emailVerified) => {
                          setRows((current) =>
                            current.map((row) =>
                              row.id === user.id
                                ? {
                                    ...row,
                                    emailVerified: new Date(emailVerified),
                                  }
                                : row,
                            ),
                          );
                        }}
                        onSubscriptionUpdated={(updatedSubscription) => {
                          setRows((current) =>
                            current.map((row) =>
                              row.id === user.id
                                ? {
                                    ...row,
                                    activeSubscription: updatedSubscription,
                                  }
                                : row,
                            ),
                          );
                        }}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </UsersTableShell>
  );
}
