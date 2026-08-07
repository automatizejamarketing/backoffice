import { AlertCircle, CheckCheck, Clock3, Eye, MessageCircle } from "lucide-react";
import Link from "next/link";
import { WhatsappDeliveryStatus } from "@/components/whatsapp-delivery-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/rbac";
import {
  getWhatsappSourceLabel,
  getWhatsappTemplateLabel,
  normalizeWhatsappHistoryFilters,
  WHATSAPP_DELIVERY_STATUSES,
  WHATSAPP_STATUS_LABELS,
  type WhatsappHistoryFilters,
  type WhatsappHistoryRawFilters,
} from "@/lib/backoffice/whatsapp-history-model";
import { formatShortDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { getWhatsappTemplateHistory } from "@/lib/db/whatsapp-template-queries";

export const dynamic = "force-dynamic";

function pageHref(filters: WhatsappHistoryFilters, page: number): string {
  const params = new URLSearchParams({
    from: filters.fromDate,
    to: filters.throughDate,
  });
  if (filters.query) params.set("q", filters.query);
  if (filters.template) params.set("template", filters.template);
  if (filters.status) params.set("status", filters.status);
  if (page > 1) params.set("page", String(page));
  return `/whatsapp?${params.toString()}`;
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof MessageCircle;
}) {
  return (
    <div className="flex min-h-24 items-center gap-3 p-4 sm:p-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<WhatsappHistoryRawFilters>;
}) {
  const [, rawFilters] = await Promise.all([
    requirePagePermission("whatsapp:view"),
    searchParams,
  ]);
  const filters = normalizeWhatsappHistoryFilters(rawFilters);
  const history = await getWhatsappTemplateHistory(filters);
  const totalPages = Math.max(1, Math.ceil(history.total / filters.pageSize));

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <header>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Templates oficiais outbound
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          WhatsApp
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Acompanhe envio, entrega, leitura e falhas dos templates automáticos.
          Respostas de clientes e conversas do Mat ou Eve não aparecem aqui.
        </p>
      </header>

      <section className="grid overflow-hidden rounded-xl border bg-card shadow-xs sm:grid-cols-2 xl:grid-cols-5 [&>div]:border-b [&>div]:border-r sm:[&>div:nth-child(2n)]:border-r-0 xl:[&>div]:border-b-0 xl:[&>div:nth-child(2n)]:border-r xl:[&>div:last-child]:border-r-0">
        <Metric label="Enviados" value={history.summary.sent} icon={MessageCircle} />
        <Metric label="Entregues" value={history.summary.delivered} icon={CheckCheck} />
        <Metric label="Lidos" value={history.summary.read} icon={Eye} />
        <Metric label="Falhos" value={history.summary.failed} icon={AlertCircle} />
        <Metric
          label="Sem status posterior"
          value={history.summary.historicalUntracked}
          icon={Clock3}
        />
      </section>

      <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="border-b p-4 sm:p-5">
          <form className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_155px_155px_220px_170px_auto] lg:items-end">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Usuário
              <Input
                name="q"
                defaultValue={filters.query}
                placeholder="Nome ou email"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              De
              <Input name="from" type="date" defaultValue={filters.fromDate} />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Até
              <Input name="to" type="date" defaultValue={filters.throughDate} />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Template
              <select
                name="template"
                defaultValue={filters.template ?? ""}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">Todos os templates</option>
                {history.templates.map((template) => (
                  <option key={template} value={template}>
                    {getWhatsappTemplateLabel(template)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Status
              <select
                name="status"
                defaultValue={filters.status ?? ""}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">Todos os status</option>
                {WHATSAPP_DELIVERY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {WHATSAPP_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              Filtrar
            </Button>
          </form>
        </div>

        {history.items.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageCircle className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Nenhum disparo encontrado</p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              Ajuste os filtros ou aguarde o próximo envio de template oficial.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto">
              <Table className="min-w-[1180px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Usuário</TableHead>
                    <TableHead>Template</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Enviado em</TableHead>
                    <TableHead>Atualizado em</TableHead>
                    <TableHead>Falha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-64">
                        <Link
                          href={`/users/${item.userId}?tab=whatsapp`}
                          className="block truncate font-medium hover:underline"
                        >
                          {item.userName ?? item.userEmail}
                        </Link>
                        {item.userName && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.userEmail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-72">
                        <p className="font-medium">
                          {getWhatsappTemplateLabel(item.templateName)}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {item.templateName}
                        </p>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {getWhatsappSourceLabel(item.source)}
                      </TableCell>
                      <TableCell>
                        <WhatsappDeliveryStatus
                          status={item.currentStatus}
                          acceptedAt={item.acceptedAt}
                          deliveredAt={item.deliveredAt}
                          readAt={item.readAt}
                          historicalStatusUntracked={item.historicalStatusUntracked}
                          compact
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatShortDateTimeInSaoPaulo(
                          item.acceptedAt ?? item.createdAt,
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatShortDateTimeInSaoPaulo(
                          item.currentStatusAt ?? item.acceptedAt ?? item.createdAt,
                        )}
                      </TableCell>
                      <TableCell className="max-w-72">
                        {item.failureCode || item.failureDetail ? (
                          <p
                            className="line-clamp-2 text-xs text-destructive"
                            title={[item.failureCode, item.failureDetail]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            {[item.failureCode, item.failureDetail]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {history.total} disparo{history.total === 1 ? "" : "s"} · página {filters.page} de {totalPages}
              </p>
              <Pagination className="mx-0 w-auto justify-start sm:justify-end">
                <PaginationContent>
                  {filters.page > 1 && (
                    <PaginationItem>
                      <PaginationPrevious
                        href={pageHref(filters, filters.page - 1)}
                        text="Anterior"
                      />
                    </PaginationItem>
                  )}
                  {filters.page < totalPages && (
                    <PaginationItem>
                      <PaginationNext
                        href={pageHref(filters, filters.page + 1)}
                        text="Próxima"
                      />
                    </PaginationItem>
                  )}
                </PaginationContent>
              </Pagination>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
