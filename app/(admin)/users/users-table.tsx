import type { UserWithUsage } from "@/lib/db/admin-queries";
import { Badge } from "@/components/ui/badge";
import {
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";
import { MessageCircle } from "lucide-react";
import { UsersTableShell } from "./users-table-shell";

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

function formatRenewalHint(daysUntilRenewal: number | null): string | null {
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
};

export function UsersTable({ users, search }: UsersTableProps) {
  return (
    <UsersTableShell>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[1880px]">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Usuário
              </th>
              <th className="w-[320px] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Empresa
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Telefone
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Plano
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Renovação
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Campanha
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Performance 7d
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Marketing
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Consultor
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Posts
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Requisições IA
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Tokens
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Custo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  {search
                    ? `Nenhum usuário encontrado para "${search}"`
                    : "Nenhum usuário encontrado"}
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const sub = user.activeSubscription;
                const badge = getStatusBadgeProps(
                  sub?.status ?? null,
                  user.expirationDate,
                  sub?.cancelAtPeriodEnd ?? false,
                  sub?.currentPeriodEnd ?? null,
                );
                const phoneFormatted = formatBrazilianPhone(user.phone);
                const whatsappUrl = getWhatsAppUrl(user.phone);
                const renewalHint = formatRenewalHint(
                  user.renewalAlert?.daysUntilRenewal ?? null,
                );
                const providerLabel = user.renewalAlert?.provider
                  ? (PROVIDER_LABELS[user.renewalAlert.provider] ??
                    user.renewalAlert.provider)
                  : sub?.provider
                    ? (PROVIDER_LABELS[sub.provider] ?? sub.provider)
                    : null;

                return (
                  <tr
                    key={user.id}
                    data-user-id={user.id}
                    data-user-email={user.email}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
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
                        <span className="text-sm font-medium text-foreground hover:underline">
                          {user.email}
                        </span>
                      </div>
                    </td>
                    <td className="w-[320px] px-4 py-3">
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
                      className="whitespace-nowrap px-4 py-3"
                      data-user-row-ignore
                    >
                      {phoneFormatted ? (
                        whatsappUrl ? (
                          <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground/80 hover:text-emerald-600 hover:underline"
                            aria-label={`Abrir conversa no WhatsApp com ${phoneFormatted}`}
                          >
                            <MessageCircle className="size-3.5 text-emerald-600" />
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
                    <td className="whitespace-nowrap px-4 py-3">
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
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
                      {user.renewalAlert ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge
                            variant="outline"
                            className={
                              user.renewalAlert.severity === "critical"
                                ? "w-fit border-red-200 bg-red-50 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
                                : "w-fit border-amber-200 bg-amber-50 text-xs text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
                            }
                          >
                            {user.renewalAlert.label}
                            {providerLabel ? ` · ${providerLabel}` : ""}
                          </Badge>
                          {renewalHint && (
                            <span className="text-[11px] text-muted-foreground">
                              {renewalHint}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="whitespace-nowrap text-sm text-muted-foreground/60">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3">
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
                    <td className="px-4 py-3 text-right text-sm text-foreground/80">
                      {formatNumber(user.postCount)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-foreground/80">
                      {formatNumber(user.requestCount)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-foreground/80">
                      {formatNumber(user.totalTokens)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-foreground">
                      {formatCurrency(user.totalCost)}
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
