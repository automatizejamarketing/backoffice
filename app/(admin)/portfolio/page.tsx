import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { requirePagePermission } from "@/lib/auth/rbac";
import { getMarketingConsultantPortfolio } from "@/lib/db/backoffice-rbac-queries";

export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default async function PortfolioPage() {
  const actor = await requirePagePermission("marketing:read");
  const accounts = await getMarketingConsultantPortfolio(actor);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <BriefcaseBusiness className="size-6" />
          Carteira de contas
        </h1>
        <p className="text-sm text-muted-foreground">
          Contas sob responsabilidade do consultor de marketing.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Status Meta</TableHead>
              <TableHead>Última atualização</TableHead>
              {actor.role === "admin" && <TableHead>Consultor</TableHead>}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={actor.role === "admin" ? 6 : 5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nenhuma conta atribuída ainda.
                </TableCell>
              </TableRow>
            ) : (
              accounts.map((account) => (
                <TableRow key={account.userId}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={account.userImageUrl ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {account.userEmail.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {account.userEmail}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {account.companyName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={account.metaAccountName ? "default" : "outline"}
                    >
                      {account.metaAccountName ? "Conectado" : "Sem Meta"}
                    </Badge>
                    {account.metaAccountName && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {account.metaAccountName}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(account.metaUpdatedAt)}
                  </TableCell>
                  {actor.role === "admin" && (
                    <TableCell className="text-sm text-muted-foreground">
                      {account.consultantEmail ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/users/${account.userId}?tab=marketing`}
                      >
                        Abrir marketing
                      </Link>
                    </Button>
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
