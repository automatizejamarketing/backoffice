import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getUserWithDetailedUsage,
  getAllUserGeneratedImages,
  getUserAuditLogs,
} from "@/lib/db/admin-queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExpirationDateControl } from "@/components/expiration-date-control";
import { CreditsControl } from "@/components/credits-control";
import { PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import type { SubscriptionStatus } from "@/lib/db/schema";
import { formatBrazilianPhone, whatsappLink } from "@/lib/phone";

const FIELD_LABELS: Record<string, string> = {
  expiration_date: "Data de expiração",
  credits: "Créditos",
};

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

const SUBSCRIPTION_STATUS_MAP: Record<
  SubscriptionStatus,
  { label: string; className: string }
> = {
  active: {
    label: "Ativo",
    className: "bg-green-500/15 text-green-700 border-green-600/20",
  },
  trialing: {
    label: "Periodo de teste",
    className: "bg-blue-500/15 text-blue-700 border-blue-600/20",
  },
  past_due: {
    label: "Pagamento pendente",
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-600/20",
  },
  canceled: {
    label: "Cancelado",
    className: "bg-red-500/15 text-red-700 border-red-600/20",
  },
  unpaid: {
    label: "Não pago",
    className: "bg-red-500/15 text-red-700 border-red-600/20",
  },
  incomplete: {
    label: "Incompleto",
    className: "bg-yellow-500/15 text-yellow-700 border-yellow-600/20",
  },
  incomplete_expired: {
    label: "Expirado",
    className: "bg-red-500/15 text-red-700 border-red-600/20",
  },
};

function SubscriptionBadge({ status }: { status: SubscriptionStatus }) {
  const config = SUBSCRIPTION_STATUS_MAP[status];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

function formatModelName(modelId: string): string {
  const labels: Record<string, string> = {
    "google/gemini-3-pro-image": "Gemini 3 Pro Image",
    "google/gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
    "google/gemini-2.0-flash": "Gemini 2.0 Flash",
  };
  return (
    labels[modelId] || modelId.split("/").pop()?.replace(/-/g, " ") || modelId
  );
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, userPostsResult, auditLogs] = await Promise.all([
    getUserWithDetailedUsage(id),
    getAllUserGeneratedImages({ userId: id, page: 1, limit: 20 }),
    getUserAuditLogs(id),
  ]);

  if (!user) {
    notFound();
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

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link
          href="/users"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Voltar para Usuários
        </Link>
      </div>

      {/* Cabeçalho com info do usuário */}
      <div className="flex items-center gap-4">
        {user.image_url ? (
          <img
            src={user.image_url}
            alt={user.email}
            className="h-16 w-16 rounded-full"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-medium text-muted-foreground">
            {user.email.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{user.email}</h1>
          <div className="mt-1 flex items-center gap-2">
            {user.companyName && (
              <Badge variant="secondary">{user.companyName}</Badge>
            )}
            {user.onboardingCompleted && (
              <Badge variant="default">Integrado</Badge>
            )}
          </div>
          {user.phone ? (
            <p className="mt-1 text-sm text-muted-foreground">
              WhatsApp:{" "}
              {(() => {
                const href = whatsappLink(user.phone);
                const formatted = formatBrazilianPhone(user.phone);
                return href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {formatted}
                  </a>
                ) : (
                  <span>{formatted}</span>
                );
              })()}
            </p>
          ) : null}
        </div>
      </div>

      {/* Assinatura Stripe */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Assinatura Stripe</CardTitle>
          <Link
            href={`/subscriptions/${id}`}
            className="inline-flex h-6 items-center justify-center rounded-md border border-border px-2 text-xs font-medium hover:bg-input/50 transition-all"
          >
            Ver detalhes
          </Link>
        </CardHeader>
        <CardContent>
          {user.activeSubscription ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Plano</p>
                <p className="text-sm font-medium text-foreground">
                  {PLAN_DEFINITIONS[user.activeSubscription.planType].name}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <SubscriptionBadge status={user.activeSubscription.status} />
              </div>
              {user.activeSubscription.currentPeriodEnd && (
                <div>
                  <p className="text-xs text-muted-foreground">
                    Próxima renovação
                  </p>
                  <p className="text-sm text-foreground">
                    {formatDate(user.activeSubscription.currentPeriodEnd)}
                  </p>
                </div>
              )}
              {user.activeSubscription.cancelAtPeriodEnd && (
                <Badge
                  variant="outline"
                  className="text-yellow-600 border-yellow-600/40"
                >
                  Cancela ao fim do período
                </Badge>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Sem assinatura</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <ExpirationDateControl
          userId={id}
          expirationDate={user.expirationDate}
        />
        <CreditsControl userId={id} credits={user.credits} />
      </div>

      {/* Cards de resumo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Custo Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {formatCurrency(user.totalCost)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total de Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {formatNumber(user.totalTokens)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Chats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {formatNumber(user.chatCount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Posts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {formatNumber(user.postCount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown de uso */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Por Modelo (agrupado) */}
        <Card>
          <CardHeader>
            <CardTitle>Uso por Modelo</CardTitle>
          </CardHeader>
          <CardContent>
            {user.usageByAction.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de uso</p>
            ) : (
              <div className="space-y-3">
                {user.usageByAction.map((entry) => (
                  <div
                    key={entry.action}
                    className="flex items-center justify-between"
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

        {/* Por Modelo */}
        <Card>
          <CardHeader>
            <CardTitle>Uso por Modelo</CardTitle>
          </CardHeader>
          <CardContent>
            {user.usageByModel.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de uso</p>
            ) : (
              <div className="space-y-3">
                {user.usageByModel.map((model) => (
                  <div
                    key={`${model.provider}-${model.modelId}`}
                    className="flex items-center justify-between"
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

      {/* Posts do usuário */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Posts do Usuário</CardTitle>
          <Link
            href={`/posts/user/${id}`}
            className="inline-flex h-6 items-center justify-center rounded-md border border-border px-2 text-xs font-medium hover:bg-input/50 transition-all"
          >
            Ver todos
          </Link>
        </CardHeader>
        <CardContent>
          {userPostsResult.posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum post criado</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {userPostsResult.posts.slice(0, 8).map((p) => (
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
                  <div className="p-2 space-y-1">
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

      {/* Histórico de alterações (backoffice) */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Alterações</CardTitle>
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
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
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

      {/* Logs de uso recentes */}
      <Card>
        <CardHeader>
          <CardTitle>Logs de Uso Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {user.recentUsage.length === 0 ? (
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
                  {user.recentUsage.map((log) => (
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
  );
}
