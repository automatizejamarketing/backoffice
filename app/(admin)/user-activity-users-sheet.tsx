"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { CopyEmailButton } from "@/components/copy-email-button";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCalendarDateLabel,
  formatShortDateTimeInSaoPaulo,
} from "@/lib/backoffice/datetime-format";
import type { UserActivitySeriesKey } from "@/lib/backoffice/user-activity-dashboard";
import { getWhatsAppUrl } from "@/lib/phone";

export type UserActivityDaySelection = {
  date: string;
  series: UserActivitySeriesKey;
};

type UserActivityDayUser = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  expirationDate: string | null;
};

const SERIES_TITLES: Record<UserActivitySeriesKey, string> = {
  newUsers: "Usuários novos",
  users: "Total de usuários",
  activeUsers: "Clientes pagantes",
};

export function UserActivityUsersSheet({
  selection,
  onClose,
}: {
  selection: UserActivityDaySelection | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<UserActivityDayUser[]>([]);

  useEffect(() => {
    if (!selection) return;

    let cancelled = false;

    async function loadUsers() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/dashboard/user-activity/users?date=${selection?.date}&series=${selection?.series}`,
        );

        if (!response.ok) {
          throw new Error("Não foi possível carregar os usuários.");
        }

        const payload = (await response.json()) as {
          users: UserActivityDayUser[];
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
  }, [selection]);

  const title = selection
    ? `${SERIES_TITLES[selection.series]} · ${formatCalendarDateLabel(selection.date)}`
    : "Usuários";

  return (
    <Sheet open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b border-border/60 px-4 py-3 sm:px-6">
          <SheetTitle className="text-left text-base">{title}</SheetTitle>
          <SheetDescription className="text-left">
            {loading
              ? "Carregando usuários…"
              : error
                ? error
                : `${users.length} usuário${users.length === 1 ? "" : "s"} neste dia.`}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            Carregando usuários…
          </p>
        ) : error ? (
          <p className="px-4 py-6 text-sm text-destructive sm:px-6">{error}</p>
        ) : users.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            Nenhum usuário encontrado.
          </p>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Expiração</TableHead>
                  <TableHead className="w-[96px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const whatsappUrl = getWhatsAppUrl(user.phone);
                  const displayName = user.name?.trim();

                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="min-w-0">
                          {displayName ? (
                            <p className="truncate font-medium">{displayName}</p>
                          ) : null}
                          <div className="flex min-w-0 items-center gap-0.5">
                            <p
                              className={
                                displayName
                                  ? "truncate text-xs text-muted-foreground"
                                  : "truncate font-medium"
                              }
                            >
                              {user.email}
                            </p>
                            <CopyEmailButton
                              email={user.email}
                              className="size-6 shrink-0"
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                        {user.expirationDate
                          ? formatShortDateTimeInSaoPaulo(user.expirationDate)
                          : "—"}
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
                              href={`/users/${user.id}`}
                              title="Abrir usuário"
                            >
                              <ExternalLink />
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
      </SheetContent>
    </Sheet>
  );
}
