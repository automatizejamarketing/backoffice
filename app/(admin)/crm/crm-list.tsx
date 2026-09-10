"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  displayLeadName,
  type CrmAccountStage,
  type CrmCommercialStatus,
} from "@/lib/backoffice/crm";
import { cn } from "@/lib/utils";
import { fetchCrmList, formatRelativeDays, type CrmDateFilters } from "./crm-api";
import { AccountStageBadge, CommercialStatusBadge, ProductTags } from "./crm-badges";

const PAGE_SIZE = 25;

export function CrmList({
  search,
  accountStage,
  commercialStatus,
  signup,
  expires,
  onOpenLead,
}: CrmDateFilters & {
  search: string;
  accountStage?: CrmAccountStage;
  commercialStatus?: CrmCommercialStatus;
  onOpenLead: (userId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const filtersKey = `${search}|${accountStage ?? ""}|${commercialStatus ?? ""}|${signup?.from ?? ""}-${signup?.to ?? ""}|${expires?.from ?? ""}-${expires?.to ?? ""}`;
  const [lastFiltersKey, setLastFiltersKey] = useState(filtersKey);
  if (filtersKey !== lastFiltersKey) {
    setLastFiltersKey(filtersKey);
    setPage(1);
  }

  const query = useQuery({
    queryKey: ["crm", "list", search, accountStage ?? "", commercialStatus ?? "", signup ?? null, expires ?? null, page],
    queryFn: () =>
      fetchCrmList({ search, accountStage, commercialStatus, signup, expires, page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // O servidor devolve a página já limitada ao total; os botões partem dela.
  const currentPage = data?.page ?? page;

  if (query.isError) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        Não deu para carregar a lista.{" "}
        <button type="button" className="font-medium underline underline-offset-2" onClick={() => void query.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <div
      aria-busy={query.isFetching}
      className={cn("rounded-xl border bg-card shadow-xs transition-opacity", query.isPlaceholderData && "opacity-60")}
    >
      <div className="overflow-x-auto">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Lead</TableHead>
              <TableHead>Status comercial</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Produtos</TableHead>
              <TableHead>Última anotação</TableHead>
              <TableHead>Consultor</TableHead>
              <TableHead>No status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              Array.from({ length: 6 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : data.leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  Nenhum lead com esses filtros.
                </TableCell>
              </TableRow>
            ) : (
              data.leads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer"
                  onClick={() => onOpenLead(lead.id)}
                >
                  <TableCell className="max-w-64">
                    <div className="truncate text-sm font-medium">{displayLeadName(lead)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {lead.companyName && lead.name ? `${lead.companyName} · ` : ""}
                      {lead.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <CommercialStatusBadge status={lead.commercialStatus} />
                  </TableCell>
                  <TableCell>
                    <AccountStageBadge stage={lead.accountStage} />
                  </TableCell>
                  <TableCell className="max-w-56">
                    {lead.productTitles.length > 0 ? (
                      <ProductTags titles={lead.productTitles} max={2} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-64">
                    {lead.lastNote ? (
                      <p className="line-clamp-2 text-xs text-muted-foreground" title={lead.lastNote.body}>
                        {lead.lastNote.body}
                      </p>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {lead.consultantName ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatRelativeDays(lead.statusChangedAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <nav
        aria-label="Paginação"
        className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground"
      >
        <span>
          {data ? `${data.total} ${data.total === 1 ? "lead" : "leads"} · página ${data.page} de ${pageCount}` : " "}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setPage(Math.max(1, currentPage - 1))}
          >
            <ChevronLeft />
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
          >
            Próxima
            <ChevronRight />
          </Button>
        </div>
      </nav>
    </div>
  );
}
