import Link from "next/link";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { getAllUsersWithUsage } from "@/lib/db/admin-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatPlanLabel,
  getStatusBadgeProps,
} from "@/lib/subscriptions/derive";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";

// Force dynamic rendering to prevent build timeouts on Vercel
// This page queries all users with usage stats, which can be slow
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const requestedPage = Number.parseInt(sp.page ?? "1", 10);
  const page =
    Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const { users, total, pageSize } = await getAllUsersWithUsage({
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Usuários</h1>
        <p className="text-sm text-muted-foreground">
          Todos os usuários cadastrados e suas estatísticas de uso
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Usuário
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Empresa
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Telefone
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Plano
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Chats
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
                  colSpan={10}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhum usuário encontrado
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
                  <td className="px-4 py-3">
                    {user.companyName ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-foreground/80">
                          {user.companyName}
                        </span>
                        {user.onboardingCompleted && (
                          <Badge variant="secondary" className="text-xs">
                            Integrado
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {phoneFormatted ? (
                      whatsappUrl ? (
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-foreground/80 hover:text-emerald-600 hover:underline"
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
                      <span className="text-sm text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {sub ? (
                      <Link
                        href={`/subscriptions/${user.id}`}
                        className="text-sm text-foreground/80 hover:underline"
                      >
                        {formatPlanLabel(sub.planType)}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground/60">—</span>
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
                  <td className="px-4 py-3 text-right text-sm text-foreground/80">
                    {formatNumber(user.chatCount)}
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
          no total
        </p>
        <div className="flex items-center gap-1.5">
          {hasPrevious ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs gap-1"
            >
              <Link href={`/users?page=${currentPage - 1}`}>
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
              <Link href={`/users?page=${currentPage + 1}`}>
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
