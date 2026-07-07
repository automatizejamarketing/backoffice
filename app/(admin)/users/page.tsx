import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { getAllUsersWithUsage } from "@/lib/db/admin-queries";
import { listActiveMarketingConsultants } from "@/lib/db/backoffice-rbac-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";
import { DEFAULT_PAGE_SIZE } from "./constants";
import { UsersTableToolbar } from "./users-table-toolbar";
import { normalizeUsersFilterParams } from "@/lib/backoffice/users-filters";
import { requirePagePermission } from "@/lib/auth/rbac";

// Force dynamic rendering to prevent build timeouts on Vercel
// This page queries all users with usage stats, which can be slow
export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    q?: string;
    subscriptionStatus?: string;
    planPeriod?: string;
    metaStatus?: string;
    consultantId?: string;
    signupWithin?: string;
    signupFrom?: string;
    signupTo?: string;
  }>;
}) {
  await requirePagePermission("users:manage");

  const sp = await searchParams;
  const filters = normalizeUsersFilterParams(sp);
  const { page, pageSize, search } = filters;

  const [{ users, total, pageSize: appliedPageSize }, consultants] =
    await Promise.all([
      getAllUsersWithUsage({
        page,
        pageSize,
        search,
        filters,
      }),
      listActiveMarketingConsultants(),
    ]);
  const totalPages = Math.max(1, Math.ceil(total / appliedPageSize));
  const currentPage = Math.min(page, totalPages);
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // Preserve `pageSize` and `q` when building pagination links so navigating
  // between pages keeps the active filter and chosen page size.
  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams();
    params.set("page", String(targetPage));
    if (pageSize !== DEFAULT_PAGE_SIZE) {
      params.set("pageSize", String(pageSize));
    }
    if (search) {
      params.set("q", search);
    }
    if (filters.subscriptionStatus !== "all") {
      params.set("subscriptionStatus", filters.subscriptionStatus);
    }
    if (filters.planPeriod !== "all") {
      params.set("planPeriod", filters.planPeriod);
    }
    if (filters.metaStatus !== "all") {
      params.set("metaStatus", filters.metaStatus);
    }
    if (filters.consultantId !== "all") {
      params.set("consultantId", filters.consultantId);
    }
    if (filters.signupWithin !== "all") {
      params.set("signupWithin", filters.signupWithin);
      if (
        filters.signupWithin === "custom" &&
        filters.signupFrom &&
        filters.signupTo
      ) {
        params.set("signupFrom", filters.signupFrom);
        params.set("signupTo", filters.signupTo);
      }
    }
    return `/users?${params.toString()}`;
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat("pt-BR").format(value);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Usuários</h1>
        <p className="text-sm text-muted-foreground">
          Todos os usuários cadastrados e suas estatísticas de uso
        </p>
      </div>

      <UsersTableToolbar
        initialSearch={search}
        pageSize={pageSize}
        filters={{
          subscriptionStatus: filters.subscriptionStatus,
          planPeriod: filters.planPeriod,
          metaStatus: filters.metaStatus,
          consultantId: filters.consultantId,
          signupWithin: filters.signupWithin,
          signupFrom: filters.signupFrom,
          signupTo: filters.signupTo,
        }}
        consultants={consultants}
      />

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[1540px]">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Usuário
              </th>
              <th className="w-[420px] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
                  colSpan={12}
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
                return (
                <tr
                  key={user.id}
                  className="transition-colors hover:bg-muted/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/users/${user.id}`}
                      className="flex items-center gap-3"
                    >
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
                    </Link>
                  </td>
                  <td className="w-[420px] px-4 py-3">
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      {user.companyName ? (
                        <span
                          className="max-w-[400px] truncate whitespace-nowrap text-sm text-foreground/80"
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
                  <td className="whitespace-nowrap px-4 py-3">
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
                      <Link
                        href={`/users/${user.id}?tab=subscription`}
                        className="whitespace-nowrap text-sm text-foreground/80 hover:underline"
                      >
                        {formatPlanLabel(sub.planType)}
                      </Link>
                    ) : (
                      <span className="whitespace-nowrap text-sm text-muted-foreground/60">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <Badge variant={badge.variant} className="text-xs w-fit">
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
                    {user.hasMetaBusinessAccount ? (
                      <Link
                        href={`/users/${user.id}?tab=marketing`}
                        className="inline-flex flex-col items-start gap-1 hover:underline"
                      >
                        <Badge variant="default" className="w-fit text-xs">
                          Meta conectado
                        </Badge>
                        {user.metaAccountName && (
                          <span className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                            {user.metaAccountName}
                          </span>
                        )}
                      </Link>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Página {currentPage} de {totalPages} · {formatNumber(total)} usuários
          {search ? " encontrados" : " no total"}
        </p>
        <div className="flex items-center gap-1.5">
          {hasPrevious ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs gap-1"
            >
              <Link href={buildPageHref(currentPage - 1)}>
                <ChevronLeft className="size-3.5" />
                Anterior
              </Link>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled
              className="h-8 px-3 text-xs gap-1"
            >
              <ChevronLeft className="size-3.5" />
              Anterior
            </Button>
          )}
          {hasNext ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs gap-1"
            >
              <Link href={buildPageHref(currentPage + 1)}>
                Próxima
                <ChevronRight className="size-3.5" />
              </Link>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled
              className="h-8 px-3 text-xs gap-1"
            >
              Próxima
              <ChevronRight className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
