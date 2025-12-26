import { getDashboardStats } from "@/lib/db/admin-queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const stats = await getDashboardStats();

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

  const statCards = [
    {
      title: "Total de Usuários",
      value: formatNumber(stats.totalUsers),
      description: "Usuários cadastrados",
      icon: "👥",
    },
    {
      title: "Usuários Ativos (7d)",
      value: formatNumber(stats.activeUsersLast7Days),
      description: "Com atividade de IA",
      icon: "🟢",
    },
    {
      title: "Custo Total de IA",
      value: formatCurrency(stats.totalCost),
      description: "Gasto total acumulado",
      icon: "💰",
    },
    {
      title: "Total de Tokens",
      value: formatNumber(stats.totalTokens),
      description: "Tokens consumidos",
      icon: "🔤",
    },
    {
      title: "Requisições de IA",
      value: formatNumber(stats.totalRequests),
      description: "Total de chamadas à API",
      icon: "🤖",
    },
    {
      title: "Total de Chats",
      value: formatNumber(stats.totalChats),
      description: "Conversas criadas",
      icon: "💬",
    },
    {
      title: "Total de Posts",
      value: formatNumber(stats.totalPosts),
      description: "Posts criados",
      icon: "📝",
    },
    {
      title: "Onboarding Completo",
      value: formatNumber(stats.completedOnboarding),
      description: "Empresas integradas",
      icon: "✅",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Painel</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral do uso da plataforma e métricas
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <span className="text-xl">{stat.icon}</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {stat.value}
              </div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
