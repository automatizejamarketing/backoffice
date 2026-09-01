"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Info, Users } from "lucide-react";
import {
  CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS,
  type CustomerBaseCategory,
} from "@/lib/backoffice/customer-base-status";
import { formatBRLFromCentavos } from "@/lib/backoffice/finance-format";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { financeProviderLabel } from "@/lib/backoffice/finance-provider";
import type { BillingProvider, PaymentSettlementMethod } from "@/lib/db/schema";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CustomerBaseStatusUser = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  expirationDate: string | null;
  totalPaidCentavos: number;
  lastPaymentProvider: BillingProvider | null;
  lastPaymentMethod: PaymentSettlementMethod | null;
};

type CustomerBaseStatusUsersDialogProps = {
  category: CustomerBaseCategory;
  title: string;
  count: number;
};

function formatExpiration(value: string | null) {
  if (!value) return "—";

  return formatShortDateTimeInSaoPaulo(value);
}

function PaymentCell({ user }: { user: CustomerBaseStatusUser }) {
  if (user.totalPaidCentavos <= 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium tabular-nums">
        {formatBRLFromCentavos(user.totalPaidCentavos)}
      </p>
      {user.lastPaymentProvider ? (
        <Badge variant="outline" className="text-[10px]">
          {financeProviderLabel({
            provider: user.lastPaymentProvider,
            paymentMethod: user.lastPaymentMethod,
          })}
        </Badge>
      ) : null}
    </div>
  );
}

export function CustomerBaseStatusUsersDialog({
  category,
  title,
  count,
}: CustomerBaseStatusUsersDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<CustomerBaseStatusUser[]>([]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadUsers() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/customer-base-status/users?category=${category}`,
        );

        if (!response.ok) {
          throw new Error("Não foi possível carregar os usuários.");
        }

        const payload = (await response.json()) as {
          users: CustomerBaseStatusUser[];
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
  }, [category, open]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(true)}
        disabled={count === 0}
      >
        <Users className="mr-1.5 size-3.5" />
        Ver usuários
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              {title}
              {category === "trial" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="E-mails excluídos desta lista"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="start"
                    className="z-[100] max-w-xs text-left"
                  >
                    <p className="mb-1.5 font-medium text-foreground">
                      Excluídos desta lista
                    </p>
                    <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                      {CUSTOMER_BASE_TRIAL_EXCLUDED_EMAILS.map((email) => (
                        <li key={email}>{email}</li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              {count === 0
                ? "Nenhum usuário nesta categoria."
                : `${count} usuário${count === 1 ? "" : "s"} nesta categoria.`}
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
                    <TableHead>Pagamento</TableHead>
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
                                {user.email}
                              </p>
                              <CopyEmailButton
                                email={user.email}
                                className="size-6 shrink-0"
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <PaymentCell user={user} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                          {formatExpiration(user.expirationDate)}
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
                                href={`/users/${user.id}`}
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
    </>
  );
}
