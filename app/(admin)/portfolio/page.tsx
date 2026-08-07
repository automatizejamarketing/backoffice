import Link from "next/link";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Settings2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BusinessHealthBadge } from "@/components/business-health-badge";
import { BusinessRulesSummary } from "@/components/business-rules-summary";
import { ManagedCampaignRefreshButton } from "@/components/managed-campaign-refresh-button";
import { ManagedCampaignRefreshStaleButton } from "@/components/managed-campaign-refresh-stale-button";
import { requirePagePermission } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import {
  normalizePortfolioFilterParams,
  PORTFOLIO_DEFAULT_PAGE_SIZE,
} from "@/lib/backoffice/portfolio-filters";
import {
  countStaleManagedCampaignAccounts,
  getBusinessOperatingRules,
  getBusinessPortfolioPage,
} from "@/lib/db/business-queries";
import { listConsultantsForFilter } from "@/lib/db/backoffice-rbac-queries";
import {
  formatShortDateInSaoPaulo,
  formatShortDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";

export const dynamic = "force-dynamic";

function formatDate(value: Date | string | null) {
  return formatShortDateInSaoPaulo(value);
}

function formatDateTime(value: Date | string | null) {
  return formatShortDateTimeInSaoPaulo(value);
}

function formatActivity(value: Date | null) {
  if (!value) return "Nunca";
  const diffDays = Math.max(
    0,
    Math.floor((Date.now() - value.getTime()) / (24 * 60 * 60 * 1000)),
  );
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Há 1 dia";
  return `Há ${diffDays} dias`;
}

function formatRenewal(daysUntilRenewal: number | null) {
  if (daysUntilRenewal === null) return "Sem data";
  if (daysUntilRenewal < 0) return "Expirado";
  if (daysUntilRenewal === 0) return "Hoje";
  if (daysUntilRenewal === 1) return "Em 1 dia";
  return `Em ${daysUntilRenewal} dias`;
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof BriefcaseBusiness;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{
    consultantId?: string | string[];
    subscriptionStatus?: string | string[];
    campaignStatus?: string | string[];
    q?: string | string[];
    page?: string | string[];
    pageSize?: string | string[];
  }>;
}) {
  const [actor, sp] = await Promise.all([
    requirePagePermission("marketing:read"),
    searchParams,
  ]);
  const filters = normalizePortfolioFilterParams(sp);

  const [rules, portfolioPage, consultants, staleMetaCount] = await Promise.all([
    getBusinessOperatingRules(),
    getBusinessPortfolioPage(actor, filters),
    actor.role === "admin" ? listConsultantsForFilter() : Promise.resolve([]),
    countStaleManagedCampaignAccounts(actor),
  ]);

  const accounts = portfolioPage.items;
  const { total, page, pageSize } = portfolioPage;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;
  const statsArePartial = total > accounts.length;

  const hasActiveFilters =
    filters.subscriptionStatus !== "all" ||
    filters.campaignStatus !== "all" ||
    filters.search.length > 0 ||
    (actor.role === "admin" && filters.consultantId !== "all");

  const criticalCount = accounts.filter(
    (account) => account.health.status === "critical",
  ).length;
  const attentionCount = accounts.filter(
    (account) => account.health.status === "attention",
  ).length;
  const renewalCount = accounts.filter((account) => {
    const days = account.health.daysUntilRenewal;
    return days !== null && days >= 0 && days <= rules.renewalAttentionDays;
  }).length;

  function buildPageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (filters.search) params.set("q", filters.search);
    if (filters.subscriptionStatus !== "all") {
      params.set("subscriptionStatus", filters.subscriptionStatus);
    }
    if (filters.campaignStatus !== "all") {
      params.set("campaignStatus", filters.campaignStatus);
    }
    if (actor.role === "admin" && filters.consultantId !== "all") {
      params.set("consultantId", filters.consultantId);
    }
    if (pageSize !== PORTFOLIO_DEFAULT_PAGE_SIZE) {
      params.set("pageSize", String(pageSize));
    }
    params.set("page", String(targetPage));
    return `/portfolio?${params.toString()}`;
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <BriefcaseBusiness className="size-6" />
            Carteira de Business
          </h1>
          <p className="text-sm text-muted-foreground">
            Fila operacional para retenção, uso do produto e contas que pedem
            ação do time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasBackofficePermission(actor, "business:manage") && (
            <Button asChild variant="outline" size="sm">
              <Link href="/business-rules">
                <Settings2 className="size-4" />
                Regras
              </Link>
            </Button>
          )}
          <ManagedCampaignRefreshStaleButton staleCount={staleMetaCount} />
        </div>
      </div>

      <form className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Buscar</span>
            <Input
              name="q"
              defaultValue={filters.search}
              placeholder="E-mail, empresa ou telefone"
              className="h-9"
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Assinatura</span>
            <Select
              name="subscriptionStatus"
              defaultValue={filters.subscriptionStatus}
            >
              <SelectTrigger className="w-full" aria-label="Assinatura">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="trialing">Em trial</SelectItem>
                  <SelectItem value="canceled">Cancelados</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Campanha [AM]</span>
            <Select
              name="campaignStatus"
              defaultValue={filters.campaignStatus}
            >
              <SelectTrigger className="w-full" aria-label="Campanha AM">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="active">Campanha ativa</SelectItem>
                  <SelectItem value="inactive">Sem campanha</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          {actor.role === "admin" ? (
            <label className="space-y-1.5 text-sm">
              <span className="text-muted-foreground">Consultor</span>
              <Select
                name="consultantId"
                defaultValue={filters.consultantId}
              >
                <SelectTrigger className="w-full" aria-label="Consultor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Todos os consultores</SelectItem>
                    <SelectItem value="unassigned">Sem consultor</SelectItem>
                    {consultants.map((consultant) => (
                      <SelectItem key={consultant.id} value={consultant.id}>
                        {consultant.name
                          ? `${consultant.name} (${consultant.email})`
                          : consultant.email}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          ) : (
            <div className="hidden xl:block" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          {hasActiveFilters && (
            <Button asChild type="button" variant="ghost" size="sm">
              <Link href="/portfolio">Limpar filtros</Link>
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Mostrando {(page - 1) * pageSize + (accounts.length > 0 ? 1 : 0)}–
            {(page - 1) * pageSize + accounts.length} de {total} clientes
          </p>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clientes visíveis" value={total} icon={BriefcaseBusiness} />
        <StatCard
          label={statsArePartial ? "Críticos (página)" : "Críticos"}
          value={criticalCount}
          icon={AlertTriangle}
        />
        <StatCard
          label={statsArePartial ? "Em atenção (página)" : "Em atenção"}
          value={attentionCount}
          icon={Clock3}
        />
        <StatCard
          label={
            statsArePartial
              ? `Renovação até ${rules.renewalAttentionDays}d (página)`
              : `Renovação até ${rules.renewalAttentionDays}d`
          }
          value={renewalCount}
          icon={CheckCircle2}
        />
      </div>

      <BusinessRulesSummary rules={rules} compact />

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Saúde</TableHead>
              <TableHead>Motivos</TableHead>
              <TableHead>Uso</TableHead>
              <TableHead>Renovação</TableHead>
              <TableHead>Créditos</TableHead>
              <TableHead>Campanha [AM]</TableHead>
              <TableHead>Playbook</TableHead>
              <TableHead>Status Meta</TableHead>
              {actor.role === "admin" && <TableHead>Consultor</TableHead>}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={actor.role === "admin" ? 11 : 10}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhum cliente encontrado para este filtro.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <TableRow key={account.userId}>
                  <TableCell>
                    <div className="flex min-w-64 items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={account.userImageUrl ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {account.userEmail.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <p className="truncate text-sm font-medium text-foreground">
                            {account.userEmail}
                          </p>
                          {account.playbookInsights.openCount > 0 ? (
                            <span
                              className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70"
                              title={`${account.playbookInsights.openCount} sugestões do playbook`}
                            >
                              · {account.playbookInsights.openCount}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {account.companyName ?? "Empresa não informada"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <BusinessHealthBadge status={account.health.status} />
                      <p className="text-xs text-muted-foreground">
                        {account.health.nextAction}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-64">
                    {account.health.reasons.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        Sem alertas
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {account.health.reasons.slice(0, 3).map((reason) => (
                          <Badge key={reason.code} variant="secondary">
                            {reason.label}
                          </Badge>
                        ))}
                        {account.health.reasons.length > 3 && (
                          <Badge variant="outline">
                            +{account.health.reasons.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-sm">
                      <p>IA: {formatActivity(account.lastAiUsageAt)}</p>
                      <p className="text-muted-foreground">
                        Posts: {formatActivity(account.lastPostAt)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-sm">
                      <p>{formatRenewal(account.health.daysUntilRenewal)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(
                          account.subscriptionCurrentPeriodEnd ??
                            account.expirationDate,
                        )}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {account.credits}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {account.hasActiveManagedCampaign ? (
                        <Badge variant="default">Campanha ativa</Badge>
                      ) : account.managedCampaignCheckedAt ? (
                        <Badge variant="outline">Sem campanha ativa</Badge>
                      ) : (
                        <Badge variant="secondary">Não verificado</Badge>
                      )}
                      {account.metaAccountName && (
                        <div>
                          <ManagedCampaignRefreshButton
                            userId={account.userId}
                            variant="secondary"
                          />
                        </div>
                      )}
                      <p className="max-w-44 text-xs text-muted-foreground">
                        Última checagem:{" "}
                        {formatDateTime(account.managedCampaignCheckedAt)}
                      </p>
                    </div>
                    {account.managedCampaignError && (
                      <p className="mt-1 max-w-44 truncate text-xs text-red-600">
                        {account.managedCampaignError}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {account.playbookInsights.openCount > 0 ? (
                      <Link
                        href={`/users/${account.userId}?tab=marketing`}
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        title="Ver sugestões do playbook"
                      >
                        {account.playbookInsights.openCount === 1
                          ? "1 sugestão"
                          : `${account.playbookInsights.openCount} sugestões`}
                      </Link>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/40">
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={account.metaAccountName ? "default" : "outline"}
                    >
                      {account.metaAccountName ? "Conectado" : "Sem Meta"}
                    </Badge>
                    {account.metaAccountName && (
                      <p className="mt-1 max-w-44 truncate text-xs text-muted-foreground">
                        {account.metaAccountName}
                      </p>
                    )}
                  </TableCell>
                  {actor.role === "admin" && (
                    <TableCell className="text-sm text-muted-foreground">
                      {account.consultantName ??
                        account.consultantEmail ??
                        "Sem consultor"}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/users/${account.userId}?tab=business`}>
                          Business
                        </Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/users/${account.userId}?tab=marketing`}>
                          Marketing
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={!hasPrevious}
              className={!hasPrevious ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={hasPrevious ? buildPageHref(page - 1) : "#"}>
                <ChevronLeft className="size-4" />
                Anterior
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              aria-disabled={!hasNext}
              className={!hasNext ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={hasNext ? buildPageHref(page + 1) : "#"}>
                Próxima
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
