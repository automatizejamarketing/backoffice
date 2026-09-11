"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CRM_STATUS_META,
  displayLeadName,
  type CrmAccountStage,
  type CrmCommercialStatus,
  type CrmKanbanColumn,
  type CrmLeadSummary,
} from "@/lib/backoffice/crm";
import {
  statusToneClassName,
  statusToneSurfaceClassName,
} from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import {
  fetchCrmKanban,
  formatRelativeDays,
  updateCrmLeadStatus,
  type CrmDateFilters,
  type CrmKanbanResponse,
} from "./crm-api";
import { AccountStageBadge, ProductTags } from "./crm-badges";

const DRAG_MIME = "application/x-crm-lead";

function moveLead(
  columns: CrmKanbanColumn[],
  userId: string,
  to: CrmCommercialStatus,
): CrmKanbanColumn[] {
  let moved: CrmLeadSummary | undefined;
  const without = columns.map((column) => {
    const lead = column.leads.find((item) => item.id === userId);
    if (!lead) return column;
    moved = lead;
    return {
      ...column,
      total: column.total - 1,
      leads: column.leads.filter((item) => item.id !== userId),
    };
  });
  if (!moved) return columns;
  const updated: CrmLeadSummary = {
    ...moved,
    commercialStatus: to,
    statusChangedAt: new Date().toISOString(),
  };
  return without.map((column) =>
    column.status === to
      ? { ...column, total: column.total + 1, leads: [updated, ...column.leads] }
      : column,
  );
}

export function CrmKanban({
  search,
  accountStage,
  signup,
  expires,
  onOpenLead,
}: CrmDateFilters & {
  search: string;
  accountStage?: CrmAccountStage;
  onOpenLead: (userId: string) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["crm", "kanban", search, accountStage ?? "", signup ?? null, expires ?? null] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => fetchCrmKanban({ search, accountStage, signup, expires }),
    placeholderData: (previous) => previous,
  });
  const [dragOver, setDragOver] = useState<CrmCommercialStatus | null>(null);

  const move = useMutation({
    mutationFn: ({ userId, to }: { userId: string; to: CrmCommercialStatus }) =>
      updateCrmLeadStatus(userId, to),
    onMutate: async ({ userId, to }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CrmKanbanResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<CrmKanbanResponse>(queryKey, {
          columns: moveLead(previous.columns, userId, to),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["crm"] });
    },
  });

  function handleDrop(event: DragEvent<HTMLElement>, to: CrmCommercialStatus) {
    event.preventDefault();
    setDragOver(null);
    const userId = event.dataTransfer.getData(DRAG_MIME);
    if (!userId) return;
    const from = query.data?.columns.find((column) =>
      column.leads.some((lead) => lead.id === userId),
    )?.status;
    if (from === to) return;
    move.mutate({ userId, to });
  }

  if (query.isError) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        Não deu para carregar o funil.{" "}
        <button type="button" className="font-medium underline underline-offset-2" onClick={() => void query.refetch()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const columns = query.data?.columns;

  return (
    <div
      aria-busy={query.isFetching}
      className={cn(
        "flex gap-3 overflow-x-auto pb-3 transition-opacity",
        query.isPlaceholderData && "opacity-60",
      )}
    >
      {(columns ?? []).map((column) => {
        const meta = CRM_STATUS_META[column.status];
        const isOver = dragOver === column.status;
        return (
          <section
            key={column.status}
            aria-label={meta.label}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(DRAG_MIME)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dragOver !== column.status) setDragOver(column.status);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragOver(null);
              }
            }}
            onDrop={(event) => handleDrop(event, column.status)}
            className={cn(
              "flex w-72 shrink-0 flex-col rounded-xl border transition-colors",
              statusToneSurfaceClassName(meta.tone),
              isOver && "border-primary bg-primary/5",
            )}
          >
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <h2 className={cn("text-sm font-semibold", statusToneClassName(meta.tone))}>
                {meta.label}
              </h2>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                {column.total}
              </span>
            </header>
            <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
              {column.leads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onOpen={() => onOpenLead(lead.id)}
                />
              ))}
              {column.leads.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  Ninguém aqui.
                </p>
              ) : column.total > column.leads.length ? (
                <p className="px-2 py-1 text-center text-xs text-muted-foreground">
                  Mostrando {column.leads.length} de {column.total}. Use a busca ou a lista para ver o resto.
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
      {!columns
        ? Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-64 w-72 shrink-0 rounded-xl" />
          ))
        : null}
    </div>
  );
}

function LeadCard({
  lead,
  onOpen,
}: {
  lead: CrmLeadSummary;
  onOpen: () => void;
}) {
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, lead.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab rounded-lg border bg-card p-3 shadow-xs active:cursor-grabbing"
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
      >
        <p className="truncate text-sm font-medium">{displayLeadName(lead)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {lead.companyName && lead.name ? `${lead.companyName} · ` : ""}
          {lead.email}
        </p>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <AccountStageBadge stage={lead.accountStage} />
        <ProductTags titles={lead.productTitles} max={1} />
      </div>
      {lead.lastNote ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground" title={lead.lastNote.body}>
          {lead.lastNote.body}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {formatRelativeDays(lead.statusChangedAt)}
        {lead.consultantName ? ` · ${lead.consultantName}` : ""}
      </p>
    </article>
  );
}
