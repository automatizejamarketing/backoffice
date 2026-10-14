"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Columns3,
  Download,
  Loader2,
  NotebookPen,
  Rows3,
  Rows4,
  Search,
  Target,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { GoalEditorDialog } from "@/components/consultant-workspace/shared/actions";
import { PlanBadge } from "@/components/consultant-workspace/shared/primitives";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/consultant-workspace/metrics";
import type { JourneyStage } from "@/lib/consultant-workspace/journey";
import type { NoteKind } from "@/lib/consultant-workspace/types";
import { useAssignmentOverrides } from "@/components/consultant-workspace/common/assignment";
import { useConsultantScope } from "@/components/consultant-workspace/common/consultant-scope";
import type { Density } from "@/components/consultant-workspace/common/grid";
import { useRememberView } from "@/components/consultant-workspace/common/last-view";
import {
  buildRows,
  handledTodayCount,
  type CarteiraRow,
  type PlanGroup,
} from "@/components/consultant-workspace/common/model";
import { useLocalPref } from "@/components/consultant-workspace/common/prefs";
import { PERIOD_OPTIONS, clientHref } from "@/components/consultant-workspace/common/routes";
import { Segmented } from "@/components/consultant-workspace/common/segmented";
import { isSnoozed, syntheticUserOf } from "@/components/consultant-workspace/common/signal-helpers";
import { SummaryStrip, computeStripCounts } from "@/components/consultant-workspace/common/summary-strip";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";
import { useWorkspaceMe } from "@/components/consultant-workspace/common/workspace-context";
import { ClientDetail, Kbd } from "./detail";
import { HelpDialog, NoteDialog, ResolveDialog, SnoozeDialog, type ActionTarget } from "./dialogs";
import { FilaView } from "./fila";
import {
  DEFAULT_DIR,
  FILA_SORTS,
  SAVED_VIEWS,
  SORT_LABEL,
  parseFilters,
  replaceParams,
  sortRows,
  type SavedViewKey,
  type SortDir,
  type SortKey,
  type ViewMode,
} from "./filters";
import { StageChips, TagFilter } from "./strip-filters";
import { COLUMNS, DEFAULT_HIDDEN, TabelaView, exportCsv, type ColKey } from "./tabela";
import { decodeAlerts, hydrateClient, type CarteiraData } from "./types";

type Modal =
  | { kind: "resolve" | "snooze"; targets: ActionTarget[]; bulk: boolean; advanceTo: { id: string | null; index: number } | null }
  | { kind: "note"; targets: ActionTarget[]; defaultKind: NoteKind }
  | { kind: "goal"; row: CarteiraRow }
  | { kind: "help" };

const PAGE = 40;

const MODE_ROUTE: Record<ViewMode, string> = { fila: "/trafego/fila", tabela: "/trafego/mesa" };

/** Atalhos de teclado nunca disparam enquanto se digita ou com um menu/diálogo aberto. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    !!target.closest(
      "[role=dialog],[role=alertdialog],[role=menu],[role=combobox],[data-radix-popper-content-wrapper],[data-slot=select-content],[cmdk-root]",
    )
  );
}

function targetFor(row: CarteiraRow): ActionTarget {
  return { userId: row.userId, name: row.title, signals: row.signals, actionIds: row.actionIds };
}

/**
 * Fila e Mesa: um espaço de trabalho, duas visões do MESMO modelo. A Fila
 * mostra um cliente por vez, do mais urgente ao menos; a Mesa, a carteira
 * inteira em números, com ações em lote. Resumo por plano no topo. Os dados
 * vêm uma vez do servidor por período; o resto é filtrado aqui.
 */
export function Carteira({ data, now, mode }: { data: CarteiraData; now: number; mode: ViewMode }) {
  const me = useWorkspaceMe();
  const { store } = usePrimedWorkspaceState(data.store, now);
  const scope = useConsultantScope();
  const assignments = useAssignmentOverrides();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [periodPending, startPeriod] = useTransition();
  const filters = useMemo(() => parseFilters(params), [params]);
  const { range } = data;
  const days = range.days;

  const clients = useMemo(() => data.clients.map((client) => hydrateClient(client, data.range)), [data]);
  const alerts = useMemo(() => decodeAlerts(data.alerts), [data]);
  const rows = useMemo(
    () => buildRows({ clients, alerts, extras: data.extras, store, range: data.range, now, assignments }),
    [clients, alerts, data.extras, data.range, store, now, assignments],
  );
  const rowById = useMemo(() => new Map(rows.map((row) => [row.userId, row])), [rows]);
  const alertUser = useMemo(() => {
    const map = new Map<string, string>(Object.entries(data.touchedAlertUser));
    for (const [id, userId] of data.alerts.rows) map.set(id, userId);
    return map;
  }, [data]);
  const handled = useMemo(() => handledTodayCount(store, alertUser, now, me.email), [store, alertUser, now, me.email]);

  /* ---------------- filtros (um estado só, na URL) ---------------- */

  const [search, setSearch] = useState(filters.q);
  const deferredSearch = useDeferredValue(search);
  const term = deferredSearch.trim().toLocaleLowerCase("pt-BR");
  const searchRef = useRef<HTMLInputElement>(null);
  const matchesScope = scope.matches;

  const facets = useMemo(() => {
    const base = rows.filter((row) => matchesScope(row.consultant) && (!term || row.searchText.includes(term)));
    const mPlan = (row: CarteiraRow) => !filters.plan || row.planGroup === filters.plan;
    const mStage = (row: CarteiraRow) => !filters.stage || row.journey.stage === filters.stage;
    const mTag = (row: CarteiraRow) => !filters.tag || row.journey.tags.some((tag) => tag.key === filters.tag);
    const mView = filters.view.filter;

    const visible = sortRows(
      base.filter((row) => mPlan(row) && mStage(row) && mTag(row) && mView(row)),
      filters.sortKey,
      filters.sortDir,
    );

    const viewCounts = {} as Record<SavedViewKey, number>;
    const forViews = base.filter((row) => mPlan(row) && mStage(row) && mTag(row));
    for (const view of SAVED_VIEWS) viewCounts[view.key] = forViews.filter(view.filter).length;

    const stageCounts: Record<JourneyStage, number> = { onboarding: 0, rodando: 0, parado: 0 };
    for (const row of base) if (mPlan(row) && mTag(row) && mView(row)) stageCounts[row.journey.stage] += 1;

    const tagCounts: Record<string, number> = {};
    for (const row of base) {
      if (!(mPlan(row) && mStage(row) && mView(row))) continue;
      for (const tag of row.journey.tags) tagCounts[tag.key] = (tagCounts[tag.key] ?? 0) + 1;
    }

    // Resumo por plano: o que está "na fila", sem o filtro de plano e de visão.
    const strip = computeStripCounts(base.filter((row) => mStage(row) && mTag(row)));

    const extra =
      filters.view.key === "precisa"
        ? {
            automatico: base
              .filter((row) => mPlan(row) && mStage(row) && mTag(row) && row.bucket === "automatico")
              .sort((a, b) => b.score - a.score),
            outras: base
              .filter((row) => mPlan(row) && mStage(row) && mTag(row) && row.bucket === "outras_areas")
              .sort((a, b) => b.score - a.score),
          }
        : null;

    return { visible, viewCounts, stageCounts, tagCounts, strip, extra };
  }, [rows, filters, term, matchesScope]);

  const { visible, extra } = facets;

  // Adiados da carteira atual (para o atalho no cabeçalho da Fila).
  const snoozedCount = useMemo(() => {
    const users = new Set<string>();
    for (const [key, action] of Object.entries(store.alertActions)) {
      if (!isSnoozed(action, now)) continue;
      const userId = syntheticUserOf(key) ?? alertUser.get(key);
      const row = userId ? rowById.get(userId) : undefined;
      if (row && matchesScope(row.consultant)) users.add(row.userId);
    }
    return users.size;
  }, [store, now, alertUser, rowById, matchesScope]);

  function setParam(key: string, value: string | null) {
    replaceParams((query) => {
      if (value == null || value === "") query.delete(key);
      else query.set(key, value);
    });
  }
  function setView(next: SavedViewKey) {
    replaceParams((query) => {
      if (next === "precisa") query.delete("filtro");
      else query.set("filtro", next);
      query.delete("ord");
      query.delete("dir");
    });
  }
  function setSort(key: SortKey, dir: SortDir) {
    replaceParams((query) => {
      query.set("ord", key);
      query.set("dir", dir);
    });
  }
  function setDays(next: number) {
    const query = new URLSearchParams(window.location.search);
    if (next === 7) query.delete("dias");
    else query.set("dias", String(next));
    const qs = query.toString();
    startPeriod(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false }));
  }
  function onSearch(value: string) {
    setSearch(value);
    setParam("q", value.trim() ? value : null);
  }
  function clearFilters() {
    setSearch("");
    replaceParams((query) => {
      for (const key of ["plano", "etapa", "tag", "q"]) query.delete(key);
    });
  }
  const hasFilters = !!(filters.plan || filters.stage || filters.tag || term);

  useRememberView(params.toString());

  /* ---------------- seleção, foco e painel ---------------- */

  const [showExtra, setShowExtra] = useState(false);
  const [focus, setFocus] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [hiddenCols, setHiddenCols] = useLocalPref<ColKey[]>("trafego:mesa-colunas-ocultas", DEFAULT_HIDDEN);
  const [density, setDensity] = useLocalPref<Density>("trafego:mesa-densidade", "compacta");

  const navigable = useMemo(
    () => (mode === "fila" && extra && showExtra ? [...visible, ...extra.automatico, ...extra.outras] : visible),
    [mode, extra, showExtra, visible],
  );
  // Se o item em foco sumiu (concluído/adiado), o da mesma posição assume: avanço automático.
  const foundIndex = focus.id ? navigable.findIndex((row) => row.userId === focus.id) : -1;
  const currentIndex =
    navigable.length === 0 ? -1 : foundIndex >= 0 ? foundIndex : Math.min(focus.index, navigable.length - 1);
  const current = currentIndex >= 0 ? navigable[currentIndex] : null;
  const renderLimit = Math.max(limit, currentIndex + 20);

  const select = useCallback(
    (index: number) => {
      if (navigable.length === 0) return;
      const clamped = Math.max(0, Math.min(index, navigable.length - 1));
      setFocus({ id: navigable[clamped].userId, index: clamped });
      if (clamped >= limit - 5) setLimit(clamped + PAGE);
    },
    [navigable, limit],
  );

  const currentId = current?.userId ?? null;
  useEffect(() => {
    if (!currentId) return;
    document.getElementById(`e-row-${currentId}`)?.scrollIntoView({ block: "nearest" });
  }, [currentId, mode]);

  const more = useCallback(() => setLimit((value) => value + PAGE), []);

  function toggleCheck(row: CarteiraRow, shift: boolean) {
    const next = new Set(checked);
    const value = !checked.has(row.userId);
    const from = shift && anchor ? visible.findIndex((entry) => entry.userId === anchor) : -1;
    const to = visible.findIndex((entry) => entry.userId === row.userId);
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from];
      for (const entry of visible.slice(start, end + 1)) {
        if (value) next.add(entry.userId);
        else next.delete(entry.userId);
      }
    } else if (value) next.add(row.userId);
    else next.delete(row.userId);
    setChecked(next);
    setAnchor(row.userId);
  }
  function toggleAll(value: boolean) {
    setChecked(value ? new Set(visible.map((row) => row.userId)) : new Set());
  }

  const checkedRows = useMemo(
    () => [...checked].map((id) => rowById.get(id)).filter(Boolean) as CarteiraRow[],
    [checked, rowById],
  );
  const bulk = mode === "tabela" && checkedRows.length > 0;

  /* ---------------- ações ---------------- */

  function actionTargets(): { targets: ActionTarget[]; bulk: boolean } {
    if (bulk) return { targets: checkedRows.map(targetFor), bulk: true };
    return { targets: current ? [targetFor(current)] : [], bulk: false };
  }
  function advanceTarget() {
    if (currentIndex < 0) return null;
    return { id: navigable[currentIndex + 1]?.userId ?? null, index: currentIndex };
  }
  function openResolve(kind: "resolve" | "snooze") {
    const { targets, bulk: isBulk } = actionTargets();
    if (targets.length === 0) return;
    if (!isBulk && targets[0].actionIds.length === 0) {
      toast.info(`${targets[0].name} não tem sinal aberto${kind === "snooze" ? " para adiar" : " para concluir"}`);
      return;
    }
    setModal({ kind, targets, bulk: isBulk, advanceTo: isBulk ? null : advanceTarget() });
  }
  function openNote(defaultKind: NoteKind = "contato") {
    const { targets } = actionTargets();
    if (targets.length === 0) return;
    setModal({ kind: "note", targets, defaultKind });
  }
  function openGoal(row?: CarteiraRow) {
    if (row) {
      setModal({ kind: "goal", row });
      return;
    }
    if (bulk) {
      if (checkedRows.length > 1) {
        toast.info("A meta é combinada com cada cliente — selecione só um.");
        return;
      }
      setModal({ kind: "goal", row: checkedRows[0] });
      return;
    }
    if (current) setModal({ kind: "goal", row: current });
  }
  function afterAction(target: { id: string | null; index: number } | null, wasBulk: boolean) {
    if (wasBulk) {
      setChecked(new Set());
      return;
    }
    if (target && target.id) setFocus(target);
  }
  function openRow(row: CarteiraRow) {
    const index = navigable.findIndex((entry) => entry.userId === row.userId);
    setFocus({ id: row.userId, index: Math.max(0, index) });
    if (mode === "tabela") setSheetOpen(true);
  }
  /** Fila ↔ Mesa: outra rota, mesma query string (filtros, busca, ordem, período). */
  function switchMode(next: ViewMode) {
    if (next === mode) return;
    router.push(`${MODE_ROUTE[next]}${window.location.search}`);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (modal) return;
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape" && event.target === searchRef.current) searchRef.current?.blur();
        return;
      }
      const key = event.key;
      const onControl = event.target instanceof HTMLElement && !!event.target.closest("button,a");
      if (key === "j" || key === "ArrowDown") {
        event.preventDefault();
        select(currentIndex + 1);
      } else if (key === "k" || key === "ArrowUp") {
        event.preventDefault();
        select(currentIndex - 1);
      } else if (key === "Enter" && current && !onControl) {
        event.preventDefault();
        if (mode === "tabela") setSheetOpen(true);
        else router.push(clientHref(current.userId, days));
      } else if (key === "o" && current) {
        event.preventDefault();
        router.push(clientHref(current.userId, days));
      } else if (key === "e") {
        event.preventDefault();
        openResolve("resolve");
      } else if (key === "s") {
        event.preventDefault();
        openResolve("snooze");
      } else if (key === "n") {
        event.preventDefault();
        openNote();
      } else if (key === "m") {
        event.preventDefault();
        openGoal();
      } else if (key === "x" && mode === "tabela" && current) {
        event.preventDefault();
        toggleCheck(current, false);
      } else if (key === "a" && mode === "fila") {
        setShowExtra((value) => !value);
      } else if (key === "v") {
        switchMode(mode === "fila" ? "tabela" : "fila");
      } else if (key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (key === "?") {
        setModal({ kind: "help" });
      } else if (key === "Escape" && mode === "tabela") {
        if (sheetOpen) setSheetOpen(false);
        else if (checked.size) setChecked(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------- render ---------------- */

  const notesFor = (userId: string) => store.notes.filter((note) => note.userId === userId).slice(0, 3);
  const detailFor = (row: CarteiraRow, openKey: string) => (
    <ClientDetail
      key={row.userId}
      row={row}
      notes={notesFor(row.userId)}
      range={range}
      now={now}
      href={clientHref(row.userId, days)}
      openKey={openKey}
      onResolve={() => openResolve("resolve")}
      onSnooze={() => openResolve("snooze")}
      onNote={() => openNote()}
      onGoal={() => setModal({ kind: "goal", row })}
    />
  );

  const filaSorts = FILA_SORTS.includes(filters.sortKey) ? FILA_SORTS : [...FILA_SORTS, filters.sortKey];
  const emptyText = filters.view.empty;

  return (
    <div className="flex min-h-[540px] flex-1 flex-col gap-2 px-3 pt-3 pb-3 lg:px-4">
      <SummaryStrip
        counts={facets.strip.counts}
        plan={filters.plan}
        onPlan={(plan: PlanGroup | null) => setParam("plano", plan)}
        handled={handled}
        remaining={facets.strip.remaining}
      />

      {/* Filtros: busca, etapa, problema, plano · período e ferramentas da Mesa */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="relative w-52 xl:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Buscar cliente ou e-mail"
            className="h-7 pr-7 pl-8 text-xs"
            aria-label="Buscar cliente"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearch("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
              /
            </kbd>
          )}
        </div>
        <StageChips counts={facets.stageCounts} stage={filters.stage} onStage={(stage) => setParam("etapa", stage)} />
        <TagFilter counts={facets.tagCounts} tag={filters.tag} onTag={(tag) => setParam("tag", tag)} />
        {filters.plan ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border pr-1 pl-2 text-xs">
            Plano <PlanBadge tier={filters.plan} />
            <button
              type="button"
              onClick={() => setParam("plano", null)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Limpar filtro de plano"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : null}
        {hasFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Limpar filtros
          </button>
        ) : null}
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          <span
            className="hidden text-[11px] text-muted-foreground tabular-nums 2xl:inline"
            title="O período fecha ontem: hoje a Meta ainda está incompleta"
          >
            {formatDay(range.from)}–{formatDay(range.to)} vs {formatDay(range.prevFrom)}–{formatDay(range.prevTo)} · dados
            até ontem
          </span>
          {periodPending ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Carregando o período" />
          ) : null}
          <Segmented
            label="Período"
            value={days}
            onChange={setDays}
            options={PERIOD_OPTIONS.map((value) => ({
              value,
              label: `${value} dias`,
              title: "Período até ontem, comparado com o mesmo número de dias antes",
            }))}
          />
          {mode === "tabela" ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                    <Columns3 className="size-3.5" />
                    <span className="hidden xl:inline">Colunas</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {COLUMNS.length - hiddenCols.length}/{COLUMNS.length}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Colunas visíveis</DropdownMenuLabel>
                  {COLUMNS.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.key}
                      checked={!hiddenCols.includes(column.key)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(value) =>
                        setHiddenCols(value ? hiddenCols.filter((key) => key !== column.key) : [...hiddenCols, column.key])
                      }
                    >
                      {column.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setHiddenCols([])}>Mostrar todas</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setHiddenCols(DEFAULT_HIDDEN)}>Voltar ao padrão</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setDensity(density === "compacta" ? "confortavel" : "compacta")}
                title={density === "compacta" ? "Linhas mais altas" : "Linhas mais baixas"}
              >
                {density === "compacta" ? <Rows4 className="size-3.5" /> : <Rows3 className="size-3.5" />}
                <span className="hidden xl:inline">{density === "compacta" ? "Compacta" : "Confortável"}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => exportCsv(visible, range, filters.view.key)}
                disabled={!visible.length}
                title="Baixar a lista filtrada em CSV"
              >
                <Download className="size-3.5" />
                <span className="hidden xl:inline">CSV</span>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/*
        Visões salvas. Com linhas marcadas na Mesa, a barra de ações em lote
        cobre esta faixa (mesma altura): a tabela não se mexe e o clique não
        cai na linha errada.
      */}
      <div className="relative h-8 shrink-0">
        <nav
          aria-label="Visões salvas"
          aria-hidden={bulk || undefined}
          className={cn(
            "-mx-1 flex h-full min-w-0 items-center gap-0.5 overflow-x-auto px-1",
            bulk && "invisible",
          )}
        >
          {SAVED_VIEWS.map((entry) => {
            const active = entry.key === filters.view.key;
            const count = facets.viewCounts[entry.key];
            return (
              <button
                key={entry.key}
                type="button"
                title={entry.hint}
                onClick={() => setView(entry.key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                  active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {entry.label}
                <span
                  className={cn(
                    "rounded px-1 text-[10px] tabular-nums",
                    active
                      ? "bg-background/20"
                      : entry.tone === "primary" && count > 0
                        ? "bg-primary text-primary-foreground"
                        : entry.tone === "bad" && count > 0
                          ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                          : entry.tone === "warn" && count > 0
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
        {bulk ? (
          <div
            role="toolbar"
            aria-label="Ações nos selecionados"
            className="absolute inset-0 z-20 flex items-center gap-2 overflow-x-auto rounded-lg border border-sky-300 bg-sky-50 px-2.5 text-sm dark:border-sky-800 dark:bg-sky-950"
          >
            <span className="shrink-0 font-medium tabular-nums">
              {checkedRows.length} {checkedRows.length === 1 ? "selecionado" : "selecionados"}
            </span>
            <span className="hidden shrink-0 text-xs text-muted-foreground xl:inline">
              · {checkedRows.filter((row) => row.actionIds.length > 0).length} com sinal aberto
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Button size="sm" className="h-6 text-xs" onClick={() => openResolve("resolve")}>
                <Check className="size-3.5" /> Concluir <Kbd>e</Kbd>
              </Button>
              <Button size="sm" variant="outline" className="h-6 bg-background text-xs" onClick={() => openResolve("snooze")}>
                <Clock className="size-3.5" /> Adiar <Kbd>s</Kbd>
              </Button>
              <Button size="sm" variant="outline" className="h-6 bg-background text-xs" onClick={() => openNote()}>
                <NotebookPen className="size-3.5" /> Nota <Kbd>n</Kbd>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 bg-background text-xs"
                onClick={() => openGoal()}
                disabled={checkedRows.length !== 1}
                title={checkedRows.length !== 1 ? "A meta é por cliente — selecione só um" : undefined}
              >
                <Target className="size-3.5" /> Meta <Kbd>m</Kbd>
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setChecked(new Set())}>
                Limpar <Kbd>Esc</Kbd>
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {mode === "fila" ? (
        <FilaView
          rows={visible}
          extra={extra}
          showExtra={showExtra}
          onToggleExtra={() => setShowExtra((value) => !value)}
          currentId={current?.userId ?? null}
          onSelect={openRow}
          limit={renderLimit}
          onMore={more}
          empty={emptyText}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
          detail={current ? detailFor(current, "↵") : null}
          header={
            <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {visible.length} {visible.length === 1 ? "cliente" : "clientes"}
              </span>
              <Link
                href="/trafego/adiados"
                className="inline-flex items-center gap-1 rounded px-1 hover:bg-muted hover:text-foreground"
                title="Sinais adiados: voltam sozinhos às 8h do dia marcado"
              >
                <Clock className="size-3" /> Adiados
                {snoozedCount > 0 ? <span className="tabular-nums">({snoozedCount})</span> : null}
              </Link>
              <label className="ml-auto flex items-center gap-1.5">
                Ordem
                <select
                  value={filters.sortKey}
                  onChange={(event) => {
                    const key = event.target.value as SortKey;
                    setSort(key, DEFAULT_DIR[key]);
                  }}
                  className="h-6 rounded border bg-background px-1 text-xs text-foreground"
                >
                  {filaSorts.map((key) => (
                    <option key={key} value={key}>
                      {SORT_LABEL[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          }
        />
      ) : (
        <TabelaView
          rows={visible}
          limit={renderLimit}
          onMore={more}
          hiddenCols={hiddenCols}
          density={density}
          sortKey={filters.sortKey}
          sortDir={filters.sortDir}
          onSort={setSort}
          focusId={current?.userId ?? null}
          checked={checked}
          onToggleCheck={toggleCheck}
          onToggleAll={toggleAll}
          onOpen={openRow}
          onGoal={(row) => openGoal(row)}
          now={now}
          hrefFor={(userId) => clientHref(userId, days)}
          emptyState={
            <>
              <p className="text-sm font-medium">{emptyText}</p>
              {hasFilters ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : null}
            </>
          }
          sheet={
            sheetOpen && current ? (
              <aside
                aria-label={`Painel de ${current.title}`}
                className="absolute inset-y-0 right-0 z-40 flex w-[min(620px,94%)] flex-col border-l bg-background shadow-2xl"
              >
                <div className="flex h-9 shrink-0 items-center gap-2 border-b px-4 text-[11px] text-muted-foreground">
                  <span>
                    <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">j</kbd>{" "}
                    <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">k</kbd> troca de cliente ·{" "}
                    <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">o</kbd> abre a página
                  </span>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                    aria-label="Fechar painel"
                  >
                    <kbd className="font-mono text-[10px]">Esc</kbd> <X className="size-3.5" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{detailFor(current, "o")}</div>
              </aside>
            ) : null
          }
        />
      )}

      {modal?.kind === "resolve" ? (
        <ResolveDialog
          targets={modal.targets}
          onOpenChange={(open) => (open ? null : setModal(null))}
          onDone={() => afterAction(modal.advanceTo, modal.bulk)}
        />
      ) : null}
      {modal?.kind === "snooze" ? (
        <SnoozeDialog
          targets={modal.targets}
          now={now}
          onOpenChange={(open) => (open ? null : setModal(null))}
          onDone={() => afterAction(modal.advanceTo, modal.bulk)}
        />
      ) : null}
      {modal?.kind === "note" ? (
        <NoteDialog
          targets={modal.targets}
          defaultKind={modal.defaultKind}
          onOpenChange={(open) => (open ? null : setModal(null))}
        />
      ) : null}
      {modal?.kind === "goal" ? (
        <GoalEditorDialog
          key={modal.row.userId}
          open
          onOpenChange={(open) => (open ? null : setModal(null))}
          userId={modal.row.userId}
          clientName={modal.row.title}
          kpi={modal.row.client.perf.kpi}
          goal={modal.row.goal}
        />
      ) : null}
      {modal?.kind === "help" ? <HelpDialog mode={mode} onOpenChange={(open) => (open ? null : setModal(null))} /> : null}
    </div>
  );
}
