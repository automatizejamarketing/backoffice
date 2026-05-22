import Link from "next/link";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Settings2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  getBusinessOperatingRules,
  getBusinessPortfolio,
} from "@/lib/db/business-queries";
import { listActiveMarketingConsultants } from "@/lib/db/backoffice-rbac-queries";
import { wasManagedCampaignCheckedToday } from "@/lib/business/managed-campaigns";

export const dynamic = "force-dynamic";

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(date);
}

function formatDateTime(value: Date | string | null) {
  if (!value) return "Nunca";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
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
  searchParams: Promise<{ consultantId?: string }>;
}) {
  const [actor, sp] = await Promise.all([
    requirePagePermission("marketing:read"),
    searchParams,
  ]);
  const consultantId =
    actor.role === "admin" ? (sp.consultantId ?? "all") : undefined;

  const [rules, accounts, consultants] = await Promise.all([
    getBusinessOperatingRules(),
    getBusinessPortfolio(actor, { consultantId }),
    actor.role === "admin" ? listActiveMarketingConsultants() : Promise.resolve([]),
  ]);

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
  const staleMetaCount = accounts.filter(
    (account) =>
      account.metaAccountName &&
      !wasManagedCampaignCheckedToday(account.managedCampaignCheckedAt),
  ).length;

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
          {actor.role === "admin" && (
            <form className="flex items-center gap-2">
              <select
                name="consultantId"
                defaultValue={consultantId}
                className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
              >
                <option value="all">Todos os consultores</option>
                <option value="unassigned">Sem consultor</option>
                {consultants.map((consultant) => (
                  <option key={consultant.id} value={consultant.id}>
                    {consultant.name ?? consultant.email}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" size="sm">
                Filtrar
              </Button>
            </form>
          )}
          {hasBackofficePermission(actor, "business:manage") && (
            <Button asChild variant="outline" size="sm">
              <Link href="/business-rules">
                <Settings2 className="size-4" />
                Regras
              </Link>
            </Button>
          )}
          <ManagedCampaignRefreshStaleButton
            consultantId={consultantId}
            staleCount={staleMetaCount}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clientes visíveis" value={accounts.length} icon={BriefcaseBusiness} />
        <StatCard label="Críticos" value={criticalCount} icon={AlertTriangle} />
        <StatCard label="Em atenção" value={attentionCount} icon={Clock3} />
        <StatCard
          label={`Renovação até ${rules.renewalAttentionDays}d`}
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
              <TableHead>Status Meta</TableHead>
              {actor.role === "admin" && <TableHead>Consultor</TableHead>}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={actor.role === "admin" ? 10 : 9}
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
                        <p className="truncate text-sm font-medium text-foreground">
                          {account.userEmail}
                        </p>
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
    </div>
  );
}
