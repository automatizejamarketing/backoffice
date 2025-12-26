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
        <h1 className="text-2xl font-bold text-zinc-900">Usuários</h1>
        <p className="text-sm text-zinc-500">
          Todos os usuários cadastrados e suas estatísticas de uso
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full">
          <thead className="border-b border-zinc-200 bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Usuário
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Empresa
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                Chats
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                Posts
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                Requisições IA
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                Tokens
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                Custo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  Nenhum usuário encontrado
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="transition-colors hover:bg-zinc-50"
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
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600">
                          {user.email.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm font-medium text-zinc-900 hover:underline">
                        {user.email}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {user.companyName ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-700">
                          {user.companyName}
                        </span>
                        {user.onboardingCompleted && (
                          <Badge variant="secondary" className="text-xs">
                            Integrado
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-700">
                    {formatNumber(user.chatCount)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-700">
                    {formatNumber(user.postCount)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-700">
                    {formatNumber(user.requestCount)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-700">
                    {formatNumber(user.totalTokens)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-zinc-900">
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
