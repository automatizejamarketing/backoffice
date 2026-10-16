"use client";

// Os indicados de um afiliado — aberto pelo nome dele na fila de `/referrals`.
// Só leitura: quem entrou, quando, se virou pagante e quanto rendeu de
// comissão. A data de acesso fica no tooltip do selo para a linha não crescer.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, UserPlus } from "lucide-react";
import { CopyEmailButton } from "@/components/copy-email-button";
import { StatusBadge } from "@/components/status-badge";
import { WhatsAppIcon } from "@/components/whatsapp-icon";
import { Button } from "@/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type {
  ReferralAffiliateStatus,
  ReferralCommissionStatus,
} from "@/lib/db/schema";
import type {
  ReferralAffiliateCustomerItem,
  ReferralAffiliateCustomers,
} from "@/lib/referral/customer-queries";
import { REFERRAL_COMMISSION_STATUS_LABELS } from "@/lib/referral/metrics";
import { formatCentavos } from "@/lib/referral/write-off";
import { getWhatsAppUrl } from "@/lib/phone";
import { LinkCustomerDialog } from "./link-customer-dialog";

export type AffiliateCustomersTarget = {
  id: string;
  code: string;
  showCode: boolean;
  status: ReferralAffiliateStatus;
  user: { email: string; name: string | null };
};

// Da mais avançada para a menos: é a ordem em que a comissão anda.
const LIVE_BREAKDOWN: ReferralCommissionStatus[] = [
  "paid",
  "approved",
  "foreseen",
];
const DEAD_BREAKDOWN: ReferralCommissionStatus[] = ["reversed", "rejected"];

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function CommissionCell({
  commission,
}: {
  commission: ReferralAffiliateCustomerItem["commission"];
}) {
  const live = LIVE_BREAKDOWN.filter(
    (status) => commission.byStatus[status] > 0,
  );
  const dead = DEAD_BREAKDOWN.filter(
    (status) => commission.byStatus[status] > 0,
  );

  if (commission.liveCentavos === 0 && dead.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-0.5">
      <p className="font-medium tabular-nums">
        {formatCentavos(commission.liveCentavos)}
      </p>
      <CommissionBreakdown
        statuses={live}
        byStatus={commission.byStatus}
        className="text-muted-foreground"
      />
      <CommissionBreakdown
        statuses={dead}
        byStatus={commission.byStatus}
        className="text-muted-foreground/70"
      />
    </div>
  );
}

// Um estado por item, sem quebra dentro dele: "Paga R$ 19,90" nunca vira
// "Paga R$ / 19,90" quando a coluna aperta.
function CommissionBreakdown({
  statuses,
  byStatus,
  className,
}: {
  statuses: ReferralCommissionStatus[];
  byStatus: ReferralAffiliateCustomerItem["commission"]["byStatus"];
  className: string;
}) {
  if (statuses.length === 0) return null;
  return (
    <ul
      className={`flex flex-wrap gap-x-2 text-[11px] tabular-nums ${className}`}
    >
      {statuses.map((status) => (
        <li key={status} className="whitespace-nowrap">
          {REFERRAL_COMMISSION_STATUS_LABELS[status]}{" "}
          {formatCentavos(byStatus[status])}
        </li>
      ))}
    </ul>
  );
}

// `open` anda separado de `target`: o afiliado continua na tela enquanto o
// sheet anima a saída, em vez de o título virar um placeholder no meio dela.
export function AffiliateCustomersSheet({
  target,
  open,
  onOpenChange,
  onCustomersChanged,
}: {
  target: AffiliateCustomersTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustomersChanged?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReferralAffiliateCustomers | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  // Muda depois de um vínculo para o efeito abaixo recarregar a lista.
  const [reloadToken, setReloadToken] = useState(0);

  const affiliateId = target?.id ?? null;

  // Recarrega a cada abertura: os números mudam enquanto a fila fica aberta.
  useEffect(() => {
    if (!open || !affiliateId) return;

    let cancelled = false;

    async function loadCustomers() {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const response = await fetch(
          `/api/referrals/${affiliateId}/customers`,
        );
        if (!response.ok) {
          throw new Error("Não foi possível carregar os indicados.");
        }
        const payload = (await response.json()) as ReferralAffiliateCustomers;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Não foi possível carregar os indicados.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCustomers();

    return () => {
      cancelled = true;
    };
  }, [open, affiliateId, reloadToken]);

  const title = target?.user.name?.trim() || target?.user.email || "Indicados";
  const customers = data?.customers ?? [];
  // Só afiliado aprovado recebe indicado (spec D5). O status do servidor vence
  // o da fila, que pode estar desatualizado.
  const canLink = (data?.affiliate.status ?? target?.status) === "approved";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border/60 px-4 py-3 sm:px-6">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 space-y-1">
              <SheetTitle className="text-left text-base">
                Indicados de {title}
              </SheetTitle>
              <SheetDescription className="text-left">
                {target?.user.email}
                {target?.showCode ? ` · código ${target.code}` : ""}
              </SheetDescription>
            </div>
            {canLink && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                data-testid="link-customer-open"
                onClick={() => setLinkOpen(true)}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Vincular indicado
              </Button>
            )}
          </div>
          {data && (
            <p className="text-left text-xs text-muted-foreground tabular-nums">
              {plural(data.summary.total, "indicado", "indicados")} ·{" "}
              {plural(data.summary.paying, "pagante", "pagantes")} ·{" "}
              {formatCentavos(data.summary.liveCommissionCentavos)} em comissão
            </p>
          )}
        </SheetHeader>

        {loading ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            Carregando indicados…
          </p>
        ) : error ? (
          <p className="px-4 py-6 text-sm text-destructive sm:px-6">{error}</p>
        ) : !data ? null : customers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
            Nenhum indicado ainda.
          </p>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4 sm:pl-6">Indicado</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Comissão</TableHead>
                    <TableHead className="w-[96px] pr-4 sm:pr-6">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => {
                    const whatsappUrl = getWhatsAppUrl(customer.user.phone);
                    const displayName = customer.user.name?.trim();
                    const manualLinkDate = customer.manualLink
                      ? formatNumericDateInSaoPaulo(customer.manualLink.linkedAt)
                      : null;

                    return (
                      <TableRow key={customer.id}>
                        <TableCell className="pl-4 sm:pl-6">
                          <div className="min-w-0 max-w-[180px]">
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
                                title={customer.user.email}
                              >
                                {customer.user.email}
                              </p>
                              <CopyEmailButton
                                email={customer.user.email}
                                className="size-6 shrink-0"
                              />
                            </div>
                            {customer.manualLink ? (
                              <p
                                className="mt-0.5 text-[11px] leading-tight text-muted-foreground [overflow-wrap:anywhere]"
                                data-testid="manual-link-marker"
                              >
                                Vinculado manualmente em {manualLinkDate} por{" "}
                                {customer.manualLink.adminEmail}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                          {formatNumericDateInSaoPaulo(customer.signedUpAt)}
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <StatusBadge badge={customer.account} />
                              </span>
                            </TooltipTrigger>
                            {customer.account.hint ? (
                              <TooltipContent>
                                {customer.account.hint}
                              </TooltipContent>
                            ) : null}
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-sm">
                          <CommissionCell commission={customer.commission} />
                        </TableCell>
                        <TableCell className="pr-4 sm:pr-6">
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
                                href={`/users/${customer.user.id}`}
                                title="Abrir usuário"
                                aria-label="Abrir usuário"
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
                  })}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}
        {target && (
          <LinkCustomerDialog
            affiliate={{ id: target.id, label: title }}
            open={linkOpen}
            onOpenChange={setLinkOpen}
            onLinked={() => {
              setReloadToken((token) => token + 1);
              onCustomersChanged?.();
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
