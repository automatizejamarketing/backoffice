"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { getWhatsAppUrl } from "@/lib/phone";
import { CopyEmailButton } from "@/components/copy-email-button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PayerRetentionCohortUser = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  firstPaidAt: string;
  expirationDate: string | null;
  activeToday: boolean;
};

type PayerRetentionCohortUsersDialogProps = {
  weekStart: string | null;
  title: string;
  initialPayers: number;
  activeToday: number;
  onOpenChange: (open: boolean) => void;
};

export function PayerRetentionCohortUsersDialog({
  weekStart,
  title,
  initialPayers,
  activeToday,
  onOpenChange,
}: PayerRetentionCohortUsersDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<PayerRetentionCohortUser[]>([]);

  useEffect(() => {
    if (!weekStart) return;

    let cancelled = false;

    async function loadUsers() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/retention/cohort-users?week=${weekStart}`,
        );

        if (!response.ok) {
          throw new Error("Não foi possível carregar os usuários.");
        }

        const payload = (await response.json()) as {
          users: PayerRetentionCohortUser[];
        };

        if (!cancelled) {
          setUsers(payload.users);
        }
      } catch {
        if (!cancelled) {
          setError("Não foi possível carregar os usuários.");
          setUsers([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  return (
    <Dialog open={weekStart !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {initialPayers === 0
              ? "Nenhum cliente entrou nesta semana."
              : `${initialPayers} cliente${initialPayers === 1 ? "" : "s"} com primeiro pagamento nesta semana · ${activeToday} com acesso ativo hoje.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando usuários…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum usuário encontrado.
          </p>
        ) : (
          <ScrollArea className="max-h-[min(60vh,520px)] rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Primeiro pagamento</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead className="w-[96px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((cohortUser) => {
                  const whatsappUrl = getWhatsAppUrl(cohortUser.phone);
                  const displayName = cohortUser.name?.trim();

                  return (
                    <TableRow key={cohortUser.id}>
                      <TableCell>
                        <div className="min-w-0">
                          {displayName ? (
                            <p className="truncate font-medium">
                              {displayName}
                            </p>
                          ) : null}
                          <div className="flex min-w-0 items-center gap-0.5">
                            <p
                              className={
                                displayName
                                  ? "truncate text-xs text-muted-foreground"
                                  : "truncate font-medium"
                              }
                            >
                              {cohortUser.email}
                            </p>
                            <CopyEmailButton
                              email={cohortUser.email}
                              className="size-6 shrink-0"
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                        {formatShortDateTimeInSaoPaulo(cohortUser.firstPaidAt)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge
                            variant="outline"
                            className={
                              cohortUser.activeToday
                                ? "border-chart-1/40 text-[10px] text-chart-1"
                                : "text-[10px] text-muted-foreground"
                            }
                          >
                            {cohortUser.activeToday ? "Ativo hoje" : "Inativo"}
                          </Badge>
                          {cohortUser.expirationDate ? (
                            <p className="text-xs tabular-nums text-muted-foreground">
                              até{" "}
                              {formatShortDateTimeInSaoPaulo(
                                cohortUser.expirationDate,
                              )}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          {/* Official WhatsApp brand icon (#25D366) */}
                          {whatsappUrl ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 hover:bg-[#25D366]/10"
                              asChild
                            >
                              <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="WhatsApp"
                                aria-label="Abrir conversa no WhatsApp"
                              >
                                <WhatsAppIcon />
                              </a>
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              disabled
                              title="Telefone indisponível"
                              aria-label="Telefone indisponível"
                            >
                              <WhatsAppIcon muted />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            asChild
                          >
                            <Link
                              href={`/users/${cohortUser.id}`}
                              title="Abrir usuário"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="size-4" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
