import Link from "next/link";
import { getAllUsersWithUsage } from "@/lib/db/admin-queries";
import { Badge } from "@/components/ui/badge";

export default async function UsersPage() {
  const users = await getAllUsersWithUsage();

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
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhum usuário encontrado
                </td>
              </tr>
            ) : (
              users.map((user) => (
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
