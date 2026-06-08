import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, X } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/rbac";
import {
  getTrackableLinkById,
  getTrackableLinkClickCount,
  listUsersByTrackableLink,
} from "@/lib/trackable-links/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

export default async function TrackableLinkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("trackable-links:manage");
  const { id } = await params;

  const link = await getTrackableLinkById(id);
  if (!link) notFound();

  const [users, clicks] = await Promise.all([
    listUsersByTrackableLink(id),
    getTrackableLinkClickCount(id),
  ]);

  const now = new Date();

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="w-fit gap-1.5" asChild>
          <Link href="/trackable-links">
            <ArrowLeft className="size-4" />
            Voltar
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{link.name}</h1>
          <Badge variant="outline" className="font-mono">
            {link.slug}
          </Badge>
          {link.deletedAt && <Badge variant="secondary">Excluído</Badge>}
        </div>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <span>
            Cliques:{" "}
            <span className="font-medium text-foreground">{clicks}</span>
          </span>
          <span>
            Cadastros:{" "}
            <span className="font-medium text-foreground">{users.length}</span>
          </span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usuários cadastrados ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Cadastro em</TableHead>
                <TableHead>Verificado</TableHead>
                <TableHead>Assinante</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    Nenhum cadastro por este link ainda.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => {
                  const isSubscriber = Boolean(
                    u.expirationDate && new Date(u.expirationDate) > now,
                  );
                  const isVerified = Boolean(u.emailVerified);
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.name ?? "—"}
                      </TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </TableCell>
                      <TableCell>
                        {isVerified ? (
                          <Badge className="gap-1">
                            <Check className="size-3" />
                            Sim
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <X className="size-3" />
                            Não
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isSubscriber ? (
                          <Badge className="gap-1">
                            <Check className="size-3" />
                            Sim
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Não</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
