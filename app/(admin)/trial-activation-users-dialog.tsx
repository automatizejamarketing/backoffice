"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  formatCalendarDateLabel,
  formatShortDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";
import {
  formatActivationDelay,
  type DailyTrialActivation,
} from "@/lib/backoffice/trial-activation";
import { formatBrtCalendarDate } from "@/lib/backoffice/dashboard-date-range";
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

type TrialActivationUser = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  signedUpAt: string | null;
  activatedAt: string;
  expirationDate: string | null;
  activeToday: boolean;
  paid: boolean;
};

function delaySeconds(user: TrialActivationUser): number | null {
  if (!user.signedUpAt) return null;
  return Math.max(
    0,
    (new Date(user.activatedAt).getTime() -
      new Date(user.signedUpAt).getTime()) /
      1000,
  );
}

// Same rule as the daily buckets: an "old account" is one created on a
// different BRT calendar day than the trial, not a fixed number of hours.
function isExistingAccount(user: TrialActivationUser): boolean {
  if (!user.signedUpAt) return true;
  return (
    formatBrtCalendarDate(new Date(user.signedUpAt)) !==
    formatBrtCalendarDate(new Date(user.activatedAt))
  );
}

function describeDay(day: DailyTrialActivation | null): string {
  if (!day || day.activations === 0) return "Nenhum trial começou neste dia.";
  const parts = [
    `${day.activations} trial${day.activations === 1 ? "" : "s"} neste dia`,
  ];
  if (day.existingAccount > 0) {
    parts.push(
      `${day.existingAccount} de conta${day.existingAccount === 1 ? "" : "s"} antiga${day.existingAccount === 1 ? "" : "s"}`,
    );
  }
  if (day.avgDelaySeconds !== null) {
    parts.push(
      `tempo médio até ativar ${formatActivationDelay(day.avgDelaySeconds)}`,
    );
  }
  return `${parts.join(" · ")}.`;
}

export function TrialActivationUsersDialog({
  day,
  onOpenChange,
}: {
  day: DailyTrialActivation | null;
  onOpenChange: (open: boolean) => void;
}) {
  const date = day?.date ?? null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<TrialActivationUser[]>([]);

  useEffect(() => {
    if (!date) return;

    let cancelled = false;

    async function loadUsers() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/trial-activation/users?date=${date}`,
        );
        if (!response.ok) {
          throw new Error("Não foi possível carregar os usuários.");
        }
        const payload = (await response.json()) as {
          users: TrialActivationUser[];
        };
        if (!cancelled) setUsers(payload.users);
      } catch {
        if (!cancelled) {
          setError("Não foi possível carregar os usuários.");
          setUsers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <Dialog open={date !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {date ? `Trials de ${formatCalendarDateLabel(date)}` : "Trials"}
          </DialogTitle>
          <DialogDescription>{describeDay(day)}</DialogDescription>
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
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead className="w-[150px]">Cadastro</TableHead>
                  <TableHead className="w-[200px]">Ativou o trial</TableHead>
                  <TableHead className="w-[120px]">Hoje</TableHead>
                  <TableHead className="w-[88px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((trialUser) => {
                  const whatsappUrl = getWhatsAppUrl(trialUser.phone);
                  const displayName = trialUser.name?.trim();
                  const delay = delaySeconds(trialUser);
                  const existingAccount = isExistingAccount(trialUser);

                  return (
                    <TableRow key={trialUser.id}>
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
                              {trialUser.email}
                            </p>
                            <CopyEmailButton
                              email={trialUser.email}
                              className="size-6 shrink-0"
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                        {formatShortDateTimeInSaoPaulo(trialUser.signedUpAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <p className="text-sm tabular-nums">
                          {formatShortDateTimeInSaoPaulo(trialUser.activatedAt)}
                        </p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {existingAccount ? "conta antiga · " : ""}
                          {formatActivationDelay(delay)} após o cadastro
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge
                            variant="outline"
                            className={
                              trialUser.activeToday
                                ? "border-chart-1/40 text-[10px] text-chart-1"
                                : "text-[10px] text-muted-foreground"
                            }
                          >
                            {trialUser.activeToday ? "Acesso ativo" : "Sem acesso"}
                          </Badge>
                          {trialUser.paid ? (
                            <Badge
                              variant="outline"
                              className="border-chart-3/40 text-[10px] text-chart-3"
                            >
                              Pagou
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
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
                              href={`/users/${trialUser.id}`}
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
