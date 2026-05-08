import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  CreditCard,
  FileImage,
  History,
  Megaphone,
  MessageCircle,
  UserRound,
} from "lucide-react";
import { MarketingWorkspace } from "@/app/(admin)/marketing/components/marketing-workspace";
import { CreditsControl } from "@/components/credits-control";
import { ExpirationDateControl } from "@/components/expiration-date-control";
import { MarketingConsultantControl } from "@/components/marketing-consultant-control";
import { SubscriptionSummaryCard } from "@/components/subscription-summary-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserSubscriptionPanel } from "@/components/user-subscription-panel";
import {
  getAllUserGeneratedImages,
  getUserAuditLogs,
  getUserHubProfile,
  getUserSubscriptionDetails,
  getUserWithDetailedUsage,
} from "@/lib/db/admin-queries";
import {
  getAssignedMarketingConsultant,
  listActiveMarketingConsultants,
} from "@/lib/db/backoffice-rbac-queries";
import {
  canAccessUserHubTab,
  hasBackofficePermission,
  USER_HUB_TAB_VALUES,
  type UserHubTab,
} from "@/lib/auth/rbac-core";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { formatBrazilianPhone, getWhatsAppUrl } from "@/lib/phone";
import { cn } from "@/lib/utils";

const TAB_CONFIG: Array<{
  value: UserHubTab;
  label: string;
  icon: typeof UserRound;
}> = [
  { value: "summary", label: "Resumo", icon: UserRound },
  { value: "subscription", label: "Assinatura", icon: CreditCard },
  { value: "marketing", label: "Marketing", icon: Megaphone },
  { value: "usage", label: "Uso", icon: BarChart3 },
  { value: "content", label: "Conteúdo", icon: FileImage },
  { value: "audit", label: "Auditoria", icon: History },
];

const FIELD_LABELS: Record<string, string> = {
  expiration_date: "Data de expiração",
  credits: "Créditos",
};

function isUserHubTab(value: string | undefined): value is UserHubTab {
  return Boolean(
    value &&
      (USER_HUB_TAB_VALUES as readonly string[]).includes(value),
  );
}

function formatAuditCellValue(
  fieldName: string,
  value: string | null,
  formatDateFull: (d: Date) => string,
): string {
  if (value === null || value === "") return "—";
  if (fieldName === "expiration_date") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return formatDateFull(d);
    }
  }
  if (fieldName === "credits") {
    return new Intl.NumberFormat("pt-BR").format(Number.parseInt(value, 10));
  }
  return value;
}

function formatModelName(modelId: string): string {
  const labels: Record<string, string> = {
    "google/gemini-3-pro-image": "Gemini 3 Pro Image",
    "google/gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
    "google/gemini-2.0-flash": "Gemini 2.0 Flash",
  };
  return labels[modelId] || modelId.split("/").pop()?.replace(/-/g, " ") || modelId;
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, sp, actor] = await Promise.all([
    params,
    searchParams,
    getCurrentBackofficeActor(),
  ]);

  if (!actor) {
    redirect("/login");
  }

  const requestedTab = isUserHubTab(sp.tab) ? sp.tab : "summary";

  if (actor.role === "marketing_consultant") {
    if (!canAccessUserHubTab(actor, id, "marketing")) {
      redirect("/portfolio");
    }
    if (requestedTab !== "marketing") {
      redirect(`/users/${id}?tab=marketing`);
    }
  } else if (!hasBackofficePermission(actor, "users:manage")) {
    redirect("/portfolio");
  }

  const activeTab: UserHubTab =
    actor.role === "marketing_consultant" ? "marketing" : requestedTab;

  if (!canAccessUserHubTab(actor, id, activeTab)) {
    redirect("/portfolio");
  }

  const profile = await getUserHubProfile(id);
  if (!profile) {
    notFound();
  }

  const isAdminHub = actor.role === "admin";
  const visibleTabs = isAdminHub
    ? TAB_CONFIG
    : TAB_CONFIG.filter((tab) => tab.value === "marketing");

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

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  const phoneFormatted = formatBrazilianPhone(profile.phone);
  const whatsappUrl = getWhatsAppUrl(profile.phone);

  const [detailedUser, subscriptionData, userPostsResult, auditLogs, consultants, assignedConsultant] =
    await Promise.all([
      isAdminHub && (activeTab === "summary" || activeTab === "usage")
        ? getUserWithDetailedUsage(id)
        : Promise.resolve(null),
      isAdminHub && activeTab === "subscription"
        ? getUserSubscriptionDetails(id)
        : Promise.resolve(null),
      isAdminHub && activeTab === "content"
        ? getAllUserGeneratedImages({ userId: id, page: 1, limit: 20 })
        : Promise.resolve(null),
      isAdminHub && activeTab === "audit"
        ? getUserAuditLogs(id)
        : Promise.resolve([]),
      isAdminHub && activeTab === "summary"
        ? listActiveMarketingConsultants()
        : Promise.resolve([]),
      isAdminHub && activeTab === "summary"
        ? getAssignedMarketingConsultant(id)
        : Promise.resolve(null),
    ]);

  if ((activeTab === "summary" || activeTab === "usage") && !detailedUser) {
    notFound();
  }
  if (activeTab === "subscription" && !subscriptionData) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={isAdminHub ? "/users" : "/portfolio"}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Voltar para {isAdminHub ? "Usuários" : "Carteira"}
        </Link>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {profile.image_url ? (
            <img
              src={profile.image_url}
              alt={profile.email}
              className="h-16 w-16 rounded-full"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-medium text-muted-foreground">
              {profile.email.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold text-foreground">
              {profile.email}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {profile.companyName && (
                <Badge variant="secondary">{profile.companyName}</Badge>
              )}
              {profile.onboardingCompleted && (
                <Badge variant="default">Integrado</Badge>
              )}
              {phoneFormatted &&
                (whatsappUrl ? (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-foreground/80 hover:text-emerald-600 hover:underline"
                    aria-label={`Abrir conversa no WhatsApp com ${phoneFormatted}`}
                  >
                    <MessageCircle className="size-4 text-emerald-600" />
                    {phoneFormatted}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-sm text-foreground/80">
                    <MessageCircle className="size-4 text-muted-foreground" />
                    {phoneFormatted}
                  </span>
                ))}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border-b">
        <nav className="flex min-w-max gap-1">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.value === activeTab;
            return (
              <Link
                key={tab.value}
                href={`/users/${id}?tab=${tab.value}`}
                className={cn(
                  "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {activeTab === "summary" && detailedUser && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <MarketingConsultantControl
              userId={id}
              consultants={consultants}
              assignedConsultantId={assignedConsultant?.consultantId ?? null}
            />
            <ExpirationDateControl
              userId={id}
              expirationDate={detailedUser.expirationDate}
            />
            <CreditsControl userId={id} credits={detailedUser.credits} />
          </div>

          <SubscriptionSummaryCard
            userId={id}
            subscription={detailedUser.activeSubscription}
            pendingPlanChange={detailedUser.activePendingPlanChange}
            expirationDate={detailedUser.expirationDate}
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Custo Total"
              value={formatCurrency(detailedUser.totalCost)}
            />
            <MetricCard
              label="Total de Tokens"
              value={formatNumber(detailedUser.totalTokens)}
            />
            <MetricCard label="Chats" value={formatNumber(detailedUser.chatCount)} />
            <MetricCard label="Posts" value={formatNumber(detailedUser.postCount)} />
          </div>
        </div>
      )}

      {activeTab === "subscription" && subscriptionData && (
        <UserSubscriptionPanel data={subscriptionData} />
      )}

      {activeTab === "marketing" && (
        <MarketingWorkspace
          initialUser={{
            id: profile.id,
            email: profile.email,
            image_url: profile.image_url,
          }}
          showHeader={false}
          showUserPicker={false}
        />
      )}

      {activeTab === "usage" && detailedUser && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Uso por Modelo</CardTitle>
              </CardHeader>
              <CardContent>
                {detailedUser.usageByAction.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados de uso</p>
                ) : (
                  <div className="space-y-3">
                    {detailedUser.usageByAction.map((entry) => (
                      <div
                        key={entry.action}
                        className="flex items-center justify-between gap-4"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {formatModelName(entry.action)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(entry.requestCount)} requisições •{" "}
                            {formatNumber(entry.totalTokens)} tokens
                          </p>
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          {formatCurrency(entry.totalCost)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Uso por Provedor</CardTitle>
              </CardHeader>
              <CardContent>
                {detailedUser.usageByModel.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados de uso</p>
                ) : (
                  <div className="space-y-3">
                    {detailedUser.usageByModel.map((model) => (
                      <div
                        key={`${model.provider}-${model.modelId}`}
                        className="flex items-center justify-between gap-4"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {model.modelId}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {model.provider} • {formatNumber(model.requestCount)}{" "}
                            requisições
                          </p>
                        </div>
                        <span className="text-sm font-medium text-foreground">
                          {formatCurrency(model.totalCost)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Logs de Uso Recentes</CardTitle>
            </CardHeader>
            <CardContent>
              {detailedUser.recentUsage.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem logs de uso</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-border">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                          Data
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                          Modelo
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                          Provedor
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">
                          Tokens
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">
                          Custo
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {detailedUser.recentUsage.map((log) => (
                        <tr key={log.id}>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {formatDate(log.createdAt)}
                          </td>
                          <td className="px-3 py-2 text-sm text-foreground">
                            {formatModelName(log.modelId)}
                          </td>
                          <td className="px-3 py-2 text-sm text-foreground/80">
                            {log.provider}
                          </td>
                          <td className="px-3 py-2 text-right text-sm text-foreground/80">
                            {formatNumber(log.totalTokens)}
                          </td>
                          <td className="px-3 py-2 text-right text-sm font-medium text-foreground">
                            {formatCurrency(Number.parseFloat(log.cost))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "content" && userPostsResult && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Posts do Usuário</CardTitle>
            <Link
              href={`/posts/user/${id}`}
              className="inline-flex h-6 items-center justify-center rounded-md border border-border px-2 text-xs font-medium transition-all hover:bg-input/50"
            >
              Ver todos
            </Link>
          </CardHeader>
          <CardContent>
            {userPostsResult.posts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum post criado</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {userPostsResult.posts.slice(0, 20).map((p) => (
                  <Link
                    key={p.id}
                    href={`/posts/${p.id}`}
                    className="group overflow-hidden rounded-md border transition-colors hover:border-primary"
                  >
                    <div className="aspect-square bg-muted">
                      {p.currentImageUrl || p.imageUrl ? (
                        <img
                          src={p.currentImageUrl || p.imageUrl || ""}
                          alt="Post"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                          Sem imagem
                        </div>
                      )}
                    </div>
                    <div className="space-y-1 p-2">
                      <p className="truncate text-xs font-medium">
                        {p.prompt.slice(0, 50) || "Sem prompt"}
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {p.aspectRatio}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "audit" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-5" />
              Histórico de Alterações
            </CardTitle>
          </CardHeader>
          <CardContent>
            {auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma alteração registrada pelo backoffice
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                        Data
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                        Admin
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                        Campo
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                        Antes → Depois
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {formatDate(log.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-sm text-foreground">
                          {log.adminEmail}
                        </td>
                        <td className="px-3 py-2 text-sm text-foreground">
                          {FIELD_LABELS[log.fieldName] ?? log.fieldName}
                        </td>
                        <td className="px-3 py-2 text-sm text-foreground/90">
                          <span className="text-muted-foreground">
                            {formatAuditCellValue(
                              log.fieldName,
                              log.oldValue,
                              formatDate,
                            )}
                          </span>
                          {" → "}
                          <span className="font-medium">
                            {formatAuditCellValue(
                              log.fieldName,
                              log.newValue,
                              formatDate,
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
