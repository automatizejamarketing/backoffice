"use client";

import { useEffect, useRef } from "react";
import { Bot, Check, ChevronDown, Inbox, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Delta, GoalBadge, PlanBadge, SeverityDot } from "@/components/consultant-workspace/shared/primitives";
import { pacingText, pacingTone } from "@/components/consultant-workspace/common/grid";
import { cn } from "@/lib/utils";
import { formatInt, formatMoney } from "@/lib/consultant-workspace/metrics";
import { firstName } from "@/components/consultant-workspace/common/workspace-context";
import { StageDot, STAGE_SHORT, stageLine } from "@/components/consultant-workspace/common/journey-bits";
import type { CarteiraRow } from "@/components/consultant-workspace/common/model";

/**
 * Fila: duas colunas — lista à esquerda, painel do cliente à direita,
 * teclado (j/k, e, s, n, m) e avanço automático. Cada item traz os números
 * do período e a etapa da jornada.
 */
export function FilaView({
  rows,
  extra,
  showExtra,
  onToggleExtra,
  currentId,
  onSelect,
  limit,
  onMore,
  empty,
  onClearFilters,
  hasFilters,
  detail,
  header,
}: {
  header: React.ReactNode;
  rows: CarteiraRow[];
  /** Só na visão "Precisa de você": o que ficou no automático e o que é de outra área. */
  extra: { automatico: CarteiraRow[]; outras: CarteiraRow[] } | null;
  showExtra: boolean;
  onToggleExtra: () => void;
  currentId: string | null;
  onSelect: (row: CarteiraRow) => void;
  limit: number;
  onMore: () => void;
  empty: string;
  onClearFilters: () => void;
  hasFilters: boolean;
  detail: React.ReactNode;
}) {
  const visible = rows.slice(0, limit);
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
      <section className="flex w-[320px] shrink-0 flex-col border-r xl:w-[380px] 2xl:w-[420px]">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Fila de clientes">
          {rows.length === 0 ? (
            <EmptyFila text={empty} hasFilters={hasFilters} onClear={onClearFilters} />
          ) : (
            <>
              {visible.map((row) => (
                <FilaItem key={row.userId} row={row} selected={row.userId === currentId} onSelect={() => onSelect(row)} />
              ))}
              {rows.length > visible.length ? <MoreSentinel onMore={onMore} left={rows.length - visible.length} /> : null}
            </>
          )}
          {extra ? (
            <>
              <CollapsedSection
                icon={Bot}
                title="Automático (o plano não pede gente)"
                count={extra.automatico.length}
                open={showExtra}
                onToggle={onToggleExtra}
                hint="Sinais que a máquina resolve: avisos de Starter e sugestões de Pro. Viram aviso no app do cliente."
              >
                {extra.automatico.map((row) => (
                  <FilaItem key={row.userId} row={row} muted selected={row.userId === currentId} onSelect={() => onSelect(row)} />
                ))}
              </CollapsedSection>
              <CollapsedSection
                icon={Wallet}
                title="Outras áreas (Financeiro / CS)"
                count={extra.outras.length}
                open={showExtra}
                onToggle={onToggleExtra}
                hint="Cartão recusado, PIX vencendo, cancelamento: o Financeiro/CS é dono. Só para contexto."
              >
                {extra.outras.map((row) => (
                  <FilaItem key={row.userId} row={row} muted selected={row.userId === currentId} onSelect={() => onSelect(row)} />
                ))}
              </CollapsedSection>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <Shortcut k="j k" label="mover" />
          <Shortcut k="↵" label="abrir" />
          <Shortcut k="e" label="concluir" />
          <Shortcut k="s" label="adiar" />
          <Shortcut k="n" label="nota" />
          <Shortcut k="m" label="meta" />
          <Shortcut k="?" label="todos" />
        </div>
      </section>
      <section className="min-w-0 flex-1 overflow-y-auto">
        {detail ?? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <Check className="size-8 text-emerald-500" />
            <p className="text-sm">Nada selecionado.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function Shortcut({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {k.split(" ").map((part) => (
        <kbd key={part} className="rounded border bg-muted px-1 font-mono text-[10px] text-foreground">
          {part}
        </kbd>
      ))}
      {label}
    </span>
  );
}

function FilaItem({
  row,
  selected,
  muted,
  onSelect,
}: {
  row: CarteiraRow;
  selected: boolean;
  muted?: boolean;
  onSelect: () => void;
}) {
  const { client, journey } = row;
  const perf = client.perf;
  const headline = row.headline;
  return (
    <button
      id={`e-row-${row.userId}`}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      title={row.reason ? `${row.rank ? `#${row.rank} · ` : ""}${row.reason}` : undefined}
      className={cn(
        "flex w-full gap-2.5 border-b border-l-2 px-3 py-2 text-left transition-colors",
        selected ? "border-l-primary bg-muted" : "border-l-transparent hover:bg-muted/40",
        muted && !selected && "opacity-75",
      )}
    >
      <span className="w-2 shrink-0 pt-1.5">
        {row.worst ? <SeverityDot severity={row.worst} /> : <span className="block size-2 rounded-full border" />}
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{row.title}</span>
          <span className="ml-auto shrink-0">
            <PlanBadge tier={client.plan.tier} />
          </span>
        </span>
        <span className={cn("block truncate text-xs", headline ? "text-foreground/85" : "text-muted-foreground")}>
          {headline ? headline.title : "Sem sinal aberto"}
          {headline && headline.times > 1 ? <span className="text-muted-foreground"> × {headline.times}</span> : null}
          {headline && headline.others > 0 ? <span className="text-muted-foreground"> · +{headline.others}</span> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
          {perf.current.spend > 0 || perf.previous.spend > 0 ? (
            <>
              <span className="text-foreground/80">{formatMoney(perf.current.spend, false)}</span>
              <Delta value={row.spendDelta} neutral className="text-[11px]" />
              <span aria-hidden>·</span>
              <span className="truncate">
                {formatInt(perf.kpi.count)} {perf.kpi.label.toLowerCase()}
                {perf.kpi.cost != null ? ` · ${perf.kpi.costLabel} ${formatMoney(perf.kpi.cost)}` : ""}
              </span>
            </>
          ) : (
            <span>sem gasto no período</span>
          )}
          {row.goal ? (
            <span className="shrink-0">
              <GoalBadge kpi={perf.kpi} goal={row.goal} />
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <StageDot stage={journey.stage} className="size-1.5" />
          <span className="truncate">
            {STAGE_SHORT[journey.stage]}
            {stageLine(journey) ? ` · ${stageLine(journey)}` : ""}
          </span>
          {row.pacing && row.goal?.monthlyBudget ? (
            <span
              className={cn(
                "shrink-0",
                pacingTone(row.pacing.ratio) === "bad" && "text-red-700 dark:text-red-400",
                pacingTone(row.pacing.ratio) === "warn" && "text-amber-700 dark:text-amber-400",
              )}
            >
              · verba {pacingText(row.pacing.ratio)}
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {row.consultantName ? (
              <span className="max-w-20 truncate rounded bg-muted px-1 text-[10px]" title={`Responsável: ${row.consultantName}`}>
                {firstName(row.consultantName) ?? row.consultantName}
              </span>
            ) : null}
            {row.rank ? <span className="text-[10px] tabular-nums">#{row.rank}</span> : null}
          </span>
        </span>
      </span>
    </button>
  );
}

function CollapsedSection({
  icon: Icon,
  title,
  count,
  open,
  onToggle,
  hint,
  children,
}: {
  icon: typeof Bot;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  hint: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="border-b bg-muted/20">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2 text-left text-muted-foreground hover:text-foreground"
      >
        <Icon className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            {title}
            <span className="rounded bg-muted px-1 tabular-nums">{count}</span>
            <kbd className="rounded border bg-background px-1 font-mono text-[10px]">a</kbd>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug">{hint}</span>
        </span>
        <ChevronDown className={cn("mt-0.5 size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t">{children}</div> : null}
    </div>
  );
}

function EmptyFila({ text, hasFilters, onClear }: { text: string; hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <Inbox className="size-5" />
      </div>
      <p className="text-sm font-medium">{text}</p>
      {hasFilters ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}

/** Carrega mais itens quando o fim da lista aparece (evita pintar a carteira inteira de uma vez). */
export function MoreSentinel({ onMore, left, asRow, colSpan }: { onMore: () => void; left: number; asRow?: boolean; colSpan?: number }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMore]);
  const content = (
    <button type="button" onClick={onMore} className="w-full py-2 text-center text-xs text-muted-foreground hover:text-foreground">
      Mostrar mais {left}
    </button>
  );
  if (asRow) {
    return (
      <tr ref={(node) => { ref.current = node; }}>
        <td colSpan={colSpan}>{content}</td>
      </tr>
    );
  }
  return <div ref={(node) => { ref.current = node; }}>{content}</div>;
}
