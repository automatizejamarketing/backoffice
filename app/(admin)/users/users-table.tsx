"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { UserWithUsage } from "@/lib/db/admin-queries";
import type { ContactStatusFilter } from "@/lib/backoffice/users-filters";
import { formatCalendarDayInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { Badge } from "@/components/ui/badge";
import {
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { canManageUserActivation } from "@/lib/backoffice/user-activation-policy";
import { resolveContactedUserIds } from "@/lib/backoffice/user-contact-marks-client";
import {
  USERS_TABLE_COLUMNS,
  USERS_TABLE_COLUMNS_STORAGE_KEY,
  defaultUsersTableColumnPrefs,
  parseUsersTableColumnPrefs,
  serializeUsersTableColumnPrefs,
  visibleUsersTableColumns,
  type UsersTableColumnId,
  type UsersTableColumnPrefs,
} from "@/lib/backoffice/users-table-columns";
import { UsersTableColumnsMenu } from "./users-table-columns-menu";
import { UsersTableShell } from "./users-table-shell";
import { UserActivationActions } from "./user-activation-actions";

const COLUMN_HEADER_CLASS: Record<UsersTableColumnId, string> = {
  user: "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  actions:
    "w-14 px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground",
  contact:
    "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  company:
    "w-[320px] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  phone:
    "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  plan: "whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  status:
    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  expiration:
    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  campaign:
    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  performance:
    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  marketing:
    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  consultant:
    "px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground",
  posts:
    "px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground",
  requests:
    "px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground",
  tokens:
    "px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground",
  cost: "px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground",
};

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Cartão",
  mercadopago: "Pix",
  manual: "Manual",
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

function persistColumnPrefs(prefs: UsersTableColumnPrefs) {
  localStorage.setItem(
    USERS_TABLE_COLUMNS_STORAGE_KEY,
    serializeUsersTableColumnPrefs(prefs),
  );
}

type UsersTableProps = {
  users: UserWithUsage[];
  search: string;
  canManageBilling: boolean;
  contactedUserIds: string[];
  contactStatus: ContactStatusFilter;
};

export function UsersTable({
  users,
  search,
  canManageBilling,
  contactedUserIds,
  contactStatus,
}: UsersTableProps) {
  const [rows, setRows] = useState(users);
  const [contactedIds, setContactedIds] = useState(contactedUserIds);
  const [columnPrefs, setColumnPrefs] = useState(defaultUsersTableColumnPrefs);

  useEffect(() => {
    setRows(users);
  }, [users]);

  useEffect(() => {
    setContactedIds(resolveContactedUserIds(contactedUserIds));
  }, [contactedUserIds]);

  useEffect(() => {
    try {
      setColumnPrefs(
        parseUsersTableColumnPrefs(
          localStorage.getItem(USERS_TABLE_COLUMNS_STORAGE_KEY),
        ),
      );
    } catch {
      localStorage.removeItem(USERS_TABLE_COLUMNS_STORAGE_KEY);
    }
  }, []);

  function updateColumnPrefs(next: UsersTableColumnPrefs) {
    setColumnPrefs(next);
    persistColumnPrefs(next);
  }

  const visibleColumns = visibleUsersTableColumns(columnPrefs);

  return (
    <UsersTableShell>
      <div className="mb-2 flex items-center justify-end gap-2">
        <UsersTableColumnsMenu
          prefs={columnPrefs}
          visibleCount={visibleColumns.length}
          onChange={updateColumnPrefs}
          onReset={() => {
            localStorage.removeItem(USERS_TABLE_COLUMNS_STORAGE_KEY);
            setColumnPrefs(defaultUsersTableColumnPrefs());
          }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-max">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              {visibleColumns.map((columnId) => {
                const column = USERS_TABLE_COLUMNS.find(
                  (item) => item.id === columnId,
                );
                return (
                  <th key={columnId} className={COLUMN_HEADER_CLASS[columnId]}>
                    {column?.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
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
                const contacted = contactedIds.includes(user.id);

                return (
                  <tr
                    key={user.id}
                    data-user-id={user.id}
                    data-user-email={user.email}
                    className="group cursor-pointer transition-colors hover:bg-muted/50"
                  >
                    {visibleColumns.map((columnId) => (
                      <OptionalColumnCell
                        key={columnId}
                        columnId={columnId}
                        user={user}
                        contacted={contacted}
                        badge={badge}
                        phoneFormatted={phoneFormatted}
                        whatsappUrl={whatsappUrl}
                        expirationHint={expirationHint}
                        providerLabel={providerLabel}
                        canManageBilling={canManageBilling}
                        contactStatus={contactStatus}
                        onContactedChange={(nextContacted) => {
                          setContactedIds((current) =>
                            nextContacted
                              ? current.includes(user.id)
                                ? current
                                : [...current, user.id]
                              : current.filter((id) => id !== user.id),
                          );
                        }}
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
                    ))}
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

function OptionalColumnCell({
  columnId,
  user,
  contacted,
  badge,
  phoneFormatted,
  whatsappUrl,
  expirationHint,
  providerLabel,
  canManageBilling,
  contactStatus,
  onContactedChange,
  onActivated,
  onSubscriptionUpdated,
}: {
  columnId: UsersTableColumnId;
  user: UserWithUsage;
  contacted: boolean;
  badge: ReturnType<typeof getStatusBadgeProps>;
  phoneFormatted: string | null;
  whatsappUrl: string | null;
  expirationHint: string | null;
  providerLabel: string | null;
  canManageBilling: boolean;
  contactStatus: ContactStatusFilter;
  onContactedChange: (contacted: boolean) => void;
  onActivated: (emailVerified: string) => void;
  onSubscriptionUpdated: (
    subscription: NonNullable<UserWithUsage["activeSubscription"]>,
  ) => void;
}) {
  const sub = user.activeSubscription;
  let content: ReactNode = null;
  let className = "px-4 py-3";
  let ignoreRowClick = columnId === "phone" || columnId === "actions";

  switch (columnId) {
    case "user":
      content = (
        <div className="flex items-center gap-3">
          {user.image_url ? (
            <img
              src={user.image_url}
              alt={user.email}
              className="size-8 rounded-full"
            />
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
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
      );
      break;
    case "actions":
      className = "px-3 py-3 text-right";
      content = (
        <UserActivationActions
          userId={user.id}
          userEmail={user.email}
          userName={user.name}
          userPhone={user.phone}
          expirationDate={user.expirationDate}
          activationAvailable={canManageUserActivation(user)}
          activeSubscription={user.activeSubscription}
          canManageBilling={canManageBilling}
          initiallyContacted={contacted}
          contactStatus={contactStatus}
          onContactedChange={onContactedChange}
          onActivated={onActivated}
          onSubscriptionUpdated={onSubscriptionUpdated}
        />
      );
      break;
    case "contact":
      content = contacted ? (
        <Badge variant="secondary" className="w-fit text-xs">
          Contatado
        </Badge>
      ) : (
        <Badge variant="outline" className="w-fit text-xs text-muted-foreground">
          Sem contato
        </Badge>
      );
      break;
    case "company":
      className = "w-[320px] px-4 py-3";
      content = (
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
            variant={user.onboardingCompleted ? "secondary" : "outline"}
            className="w-fit whitespace-nowrap text-xs"
          >
            {user.onboardingCompleted ? "Integrado" : "Não integrado"}
          </Badge>
        </div>
      );
      break;
    case "phone":
      className = "whitespace-nowrap px-4 py-3";
      content = phoneFormatted ? (
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
          <span className="text-sm text-foreground/80">{phoneFormatted}</span>
        )
      ) : (
        <span className="whitespace-nowrap text-sm text-muted-foreground/60">
          —
        </span>
      );
      break;
    case "plan":
      className = "whitespace-nowrap px-4 py-3";
      content = sub ? (
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
      );
      break;
    case "status":
      content = (
        <div className="flex flex-col gap-0.5">
          <Badge variant={badge.variant} className="w-fit text-xs">
            {badge.label}
          </Badge>
          {badge.hint ? (
            <span className="text-[11px] text-muted-foreground">
              {badge.hint}
            </span>
          ) : null}
        </div>
      );
      break;
    case "expiration":
      content = user.expirationDate ? (
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
      );
      break;
    case "campaign":
      content = user.hasActiveManagedCampaign ? (
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
      );
      break;
    case "performance":
      content = user.performanceDrop.hasDrop ? (
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
      );
      break;
    case "marketing":
      content = user.hasMetaBusinessAccount ? (
        <div className="inline-flex flex-col items-start gap-1">
          <Badge variant="default" className="w-fit text-xs">
            Meta conectado
          </Badge>
          {user.metaAccountName ? (
            <span className="max-w-[180px] truncate text-[11px] text-muted-foreground">
              {user.metaAccountName}
            </span>
          ) : null}
        </div>
      ) : (
        <Badge variant="outline" className="w-fit text-xs">
          Sem Meta
        </Badge>
      );
      break;
    case "consultant":
      content = user.assignedConsultantEmail ? (
        <div className="flex max-w-[220px] flex-col">
          <span className="truncate text-sm text-foreground/80">
            {user.assignedConsultantName ?? user.assignedConsultantEmail}
          </span>
          {user.assignedConsultantName ? (
            <span className="truncate text-xs text-muted-foreground">
              {user.assignedConsultantEmail}
            </span>
          ) : null}
        </div>
      ) : (
        <span className="whitespace-nowrap text-sm text-muted-foreground/60">
          —
        </span>
      );
      break;
    case "posts":
      className = "px-4 py-3 text-right text-sm text-foreground/80";
      content = formatNumber(user.postCount);
      break;
    case "requests":
      className = "px-4 py-3 text-right text-sm text-foreground/80";
      content = formatNumber(user.requestCount);
      break;
    case "tokens":
      className = "px-4 py-3 text-right text-sm text-foreground/80";
      content = formatNumber(user.totalTokens);
      break;
    case "cost":
      className = "px-4 py-3 text-right text-sm font-medium text-foreground";
      content = formatCurrency(user.totalCost);
      break;
    default: {
      const exhaustiveCheck: never = columnId;
      return exhaustiveCheck;
    }
  }

  return (
    <td
      className={className}
      data-user-row-ignore={ignoreRowClick ? "" : undefined}
    >
      {content}
    </td>
  );
}
