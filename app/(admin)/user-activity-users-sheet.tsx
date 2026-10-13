"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
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
import type { UserActivityDaySeriesKey } from "@/lib/backoffice/user-activity-dashboard";
import { getWhatsAppUrl } from "@/lib/phone";

/** "day" opens every event of the date, one section per kind. */
export type UserActivityDaySelection = {
  date: string;
  series: UserActivityDaySeriesKey | "day";
};

/** Sections of the day view, in the order they read in the tooltip. */
export const USER_ACTIVITY_DAY_GROUPS = [
  { key: "newUsers", label: "Cadastros", count: ["cadastro", "cadastros"] },
  { key: "trials", label: "Trials", count: ["trial", "trials"] },
  { key: "payments", label: "Pagamentos", count: ["pagamento", "pagamentos"] },
  { key: "churn", label: "Churn", count: ["churn", "churn"] },
] as const satisfies readonly {
  key: UserActivityDaySeriesKey;
  label: string;
  count: readonly [string, string];
}[];

type DayGroupKey = (typeof USER_ACTIVITY_DAY_GROUPS)[number]["key"];

type UserGroup = {
  key: UserActivityDaySeriesKey;
  label: string;
  users: UserActivityDayUser[];
};

type UserActivityDayUser = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  expirationDate: string | null;
};

const SERIES_TITLES: Record<UserActivityDaySeriesKey, string> = {
  newUsers: "Cadastros",
  trials: "Trials iniciados",
  payments: "Primeiros pagamentos",
  users: "Total de usuários",
  activeUsers: "Clientes pagantes",
  churn: "Churn · acesso expirou",
};

async function fetchSeriesUsers(
  date: string,
  series: UserActivityDaySeriesKey,
): Promise<UserActivityDayUser[]> {
  const response = await fetch(
    `/api/dashboard/user-activity/users?date=${date}&series=${series}`,
  );
  if (!response.ok) throw new Error("Não foi possível carregar os usuários.");
  const payload = (await response.json()) as { users: UserActivityDayUser[] };
  return payload.users;
}

export function UserActivityUsersSheet({
  selection,
  groupColors,
  onClose,
}: {
  selection: UserActivityDaySelection | null;
  groupColors: Record<DayGroupKey, string>;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<UserGroup[]>([]);

  useEffect(() => {
    if (!selection) return;

    let cancelled = false;
    const { date, series } = selection;
    const wanted =
      series === "day"
        ? USER_ACTIVITY_DAY_GROUPS.map((group) => ({ ...group }))
        : [{ key: series, label: SERIES_TITLES[series] }];

    async function loadUsers() {
      setLoading(true);
      setError(null);

      try {
        const loaded = await Promise.all(
          wanted.map(async (group) => ({
            ...group,
            users: await fetchSeriesUsers(date, group.key),
          })),
        );
        if (!cancelled) setGroups(loaded);
      } catch {
        if (!cancelled) {
          setError("Não foi possível carregar os usuários.");
          setGroups([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [selection]);

  const isDayView = selection?.series === "day";
  const visibleGroups = groups.filter((group) => group.users.length > 0);
  const total = groups.reduce((sum, group) => sum + group.users.length, 0);
  const title = selection
    ? `${
        selection.series === "day" ? "Dia" : SERIES_TITLES[selection.series]
      } · ${formatCalendarDateLabel(selection.date)}`
    : "Usuários";
  const description = isDayView
    ? USER_ACTIVITY_DAY_GROUPS.map((dayGroup) => {
        const size =
          groups.find((group) => group.key === dayGroup.key)?.users.length ?? 0;
        return `${size} ${dayGroup.count[size === 1 ? 0 : 1]}`;
      }).join(" · ")
    : `${total} usuário${total === 1 ? "" : "s"} neste dia.`;

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
                : description}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            Carregando usuários…
          </p>
        ) : error ? (
          <p className="px-4 py-6 text-sm text-destructive sm:px-6">{error}</p>
        ) : visibleGroups.length === 0 ? (
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
                {visibleGroups.map((group) => (
                  <Fragment key={group.key}>
                    {isDayView ? (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={3} className="py-2">
                          <span className="flex items-center gap-2 text-xs font-medium">
                            <span
                              className="size-2.5 shrink-0 rounded-[2px]"
                              style={{
                                backgroundColor:
                                  groupColors[group.key as DayGroupKey],
                              }}
                              aria-hidden
                            />
                            {group.label}
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {group.users.length}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {group.users.map((user) => (
                      <UserRow key={`${group.key}-${user.id}`} user={user} />
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function UserRow({ user }: { user: UserActivityDayUser }) {
  const whatsappUrl = getWhatsAppUrl(user.phone);
  const displayName = user.name?.trim();

  return (
    <TableRow>
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
            <CopyEmailButton email={user.email} className="size-6 shrink-0" />
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
          <Button variant="ghost" size="icon" className="size-8" asChild>
            <Link
              href={`/users/${user.id}`}
              title="Abrir usuário"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
