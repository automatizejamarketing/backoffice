import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserWithDetailedUsage } from "@/lib/db/admin-queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getUserWithDetailedUsage(id);

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
          className="text-sm text-zinc-500 hover:text-zinc-900"
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
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-2xl font-medium text-zinc-600">
            {user.email.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{user.email}</h1>
          <div className="mt-1 flex items-center gap-2">
            {user.companyName && (
              <Badge variant="secondary">{user.companyName}</Badge>
            )}
            {user.onboardingCompleted && (
              <Badge variant="default">Integrado</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-500">
              Custo Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">
              {formatCurrency(user.totalCost)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-500">
              Total de Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">
              {formatNumber(user.totalTokens)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-500">
              Chats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">
              {formatNumber(user.chatCount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-500">
              Posts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">
              {formatNumber(user.postCount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown de uso */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Por Ação */}
        <Card>
          <CardHeader>
            <CardTitle>Uso por Ação</CardTitle>
          </CardHeader>
          <CardContent>
            {user.usageByAction.length === 0 ? (
              <p className="text-sm text-zinc-500">Sem dados de uso</p>
            ) : (
              <div className="space-y-3">
                {user.usageByAction.map((action) => (
                  <div
                    key={action.action}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-900">
                        {action.action}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatNumber(action.requestCount)} requisições •{" "}
                        {formatNumber(action.totalTokens)} tokens
                      </p>
                    </div>
                    <span className="text-sm font-medium text-zinc-900">
                      {formatCurrency(action.totalCost)}
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
              <p className="text-sm text-zinc-500">Sem dados de uso</p>
            ) : (
              <div className="space-y-3">
                {user.usageByModel.map((model) => (
                  <div
                    key={`${model.provider}-${model.modelId}`}
                    className="flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-900">
                        {model.modelId}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {model.provider} • {formatNumber(model.requestCount)}{" "}
                        requisições
                      </p>
                    </div>
                    <span className="text-sm font-medium text-zinc-900">
                      {formatCurrency(model.totalCost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Logs de uso recentes */}
      <Card>
        <CardHeader>
          <CardTitle>Logs de Uso Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {user.recentUsage.length === 0 ? (
            <p className="text-sm text-zinc-500">Sem logs de uso</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-zinc-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-zinc-500">
                      Data
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-zinc-500">
                      Ação
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-zinc-500">
                      Modelo
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-zinc-500">
                      Tokens
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-medium uppercase text-zinc-500">
                      Custo
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {user.recentUsage.map((log) => (
                    <tr key={log.id}>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-sm text-zinc-900">
                        {log.action}
                      </td>
                      <td className="px-3 py-2 text-sm text-zinc-700">
                        {log.modelId}
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-zinc-700">
                        {formatNumber(log.totalTokens)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-medium text-zinc-900">
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
