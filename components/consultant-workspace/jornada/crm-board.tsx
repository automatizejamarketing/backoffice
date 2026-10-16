"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Mail,
  MessageSquare,
  Phone,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CRM_HEALTH_LABEL,
  CRM_HEALTH_ORDER,
  CRM_OWNERS,
  canMoveTo,
  crmHealth,
  crmMatDraft,
  crmOwner,
  crmOwnerByEmail,
  crmPlacement,
  planStatus,
  type CrmHealth,
  type CrmOwnerKey,
  type CrmPlacement,
  type PlanStatusTone,
} from "@/lib/consultant-workspace/crm";
import type { JourneyExtras } from "@/lib/consultant-workspace/journey";
import { PLAN_RANK } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceClient, WorkspaceRange, WorkspaceState, WorkspaceTask } from "@/lib/consultant-workspace/types";
import { MAT_TEMPLATE_PREFIX } from "@/lib/consultant-workspace/outreach-core";
import type { MatDraft } from "@/lib/consultant-workspace/playbook-actions";
import { PlanText } from "@/components/consultant-workspace/common/journey-bits";
import { useRememberView } from "@/components/consultant-workspace/common/last-view";
import { planGroupOf, type PlanGroup } from "@/components/consultant-workspace/common/model";
import { nextStep, type NextStep } from "@/components/consultant-workspace/common/next-step";
import { clientHref } from "@/components/consultant-workspace/common/routes";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";
import { useWorkspaceMe } from "@/components/consultant-workspace/common/workspace-context";
import { replaceParams } from "@/components/consultant-workspace/carteira/filters";
import { TemplateComposerDialog, type ComposerTarget } from "@/components/consultant-workspace/cliente/composer";
import { OutreachDialog } from "@/components/consultant-workspace/shared/outreach-dialog";
import { formatPhone, plural, primaryTemplateKey, type SlimAlert, type StoppedSpend } from "./lib";
import { useJourneyRows, type JourneyRow } from "./use-journeys";

const PLAN_FILTERS: Array<{ key: PlanGroup | null; label: string }> = [
  { key: null, label: "Todos os planos" },
  { key: "premium", label: "Premium" },
  { key: "pro", label: "Pro" },
  { key: "starter", label: "Starter" },
];

const STATUS_TONE: Record<PlanStatusTone, string> = {
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
};

const HEALTH_DOT: Record<CrmHealth, string> = {
  regularizar: "bg-red-500",
  erro: "bg-red-500",
  parado: "bg-amber-500",
  onboarding: "bg-sky-500",
  recomendacao: "bg-violet-500",
  ok: "bg-emerald-500",
};

/** Cards por grupo antes do "ver mais". */
const GROUP_PREVIEW = 6;

type Card = JourneyRow & {
  step: NextStep | null;
  placement: CrmPlacement;
  health: CrmHealth;
  openTask: WorkspaceTask | null;
  lastDone: WorkspaceTask | null;
  /** Reativar, regularizar ou liberar na Meta — pela Mat. */
  mat: MatDraft | null;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function matchesSearch(client: WorkspaceClient, query: string) {
  if (!query) return true;
  const digits = query.replace(/\D/g, "");
  const haystack = normalize([client.displayName, client.name ?? "", client.email].join(" "));
  if (haystack.includes(normalize(query))) return true;
  return digits.length >= 4 && (client.phone ?? "").replace(/\D/g, "").includes(digits);
}

function copy(text: string, what: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${what} copiado`))
    .catch(() => toast.error("Não deu para copiar"));
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits.length <= 11 ? `55${digits}` : digits}`;
}

/**
 * CRM: uma coluna por responsável operacional (Fred, Gui, Lucas, Comelli).
 * Quem não tem responsável cai pela regra de `crm.ts`; arrastar o card (ou
 * passar com tarefa) grava o novo responsável. O card mostra só o que serve
 * para agir: plano e situação, datas, contato, estágio e a tarefa aberta.
 */
export function CrmBoard({
  range,
  clients,
  alerts,
  extras,
  stopped,
  initialStore,
  now,
}: {
  range: WorkspaceRange;
  clients: WorkspaceClient[];
  alerts: SlimAlert[];
  extras: Record<string, JourneyExtras>;
  stopped: Record<string, StoppedSpend>;
  initialStore: WorkspaceState;
  /** Relógio da leitura (servidor): base de "há N dias", nunca `Date.now()` no render. */
  now: number;
}) {
  const me = useWorkspaceMe();
  const mine = crmOwnerByEmail(me.email)?.key ?? null;
  const { store, apply, isSaving } = usePrimedWorkspaceState(initialStore, now);
  const params = useSearchParams();
  useRememberView(params.toString());
  const rawPlan = params.get("plano") as PlanGroup | null;
  const plan = rawPlan && ["premium", "pro", "starter"].includes(rawPlan) ? rawPlan : null;
  const rawOwner = params.get("responsavel");
  const ownerFilter = crmOwner(rawOwner)?.key ?? null;
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [passing, setPassing] = useState<{ card: Card; to: CrmOwnerKey | null } | null>(null);
  // Troca feita nesta aba vale na hora; a leitura do servidor tem alguns minutos de cache.
  const [moved, setMoved] = useState<Map<string, CrmOwnerKey>>(new Map());
  const [dragOver, setDragOver] = useState<CrmOwnerKey | null>(null);
  const [mat, setMat] = useState<Card | null>(null);

  const rows = useJourneyRows(clients, alerts, extras, store, now);

  const tasksByUser = useMemo(() => {
    const map = new Map<string, WorkspaceTask[]>();
    for (const task of store.tasks ?? []) {
      const list = map.get(task.userId) ?? [];
      list.push(task);
      map.set(task.userId, list);
    }
    return map;
  }, [store.tasks]);

  const cards = useMemo<Card[]>(
    () =>
      rows.map((row) => {
        const { client, journey } = row;
        const step = nextStep(client, journey, {
          alerts: row.alerts,
          stopped: stopped[client.userId] ?? null,
          goal: store.goals[client.userId] ?? null,
        });
        const basePlacement = crmPlacement({
          access: client.access,
          assignedEmail: client.consultant.email,
          stage: journey.stage,
          tier: client.plan.tier,
        });
        const override = moved.get(client.userId);
        const placement: CrmPlacement =
          override && canMoveTo(client.access, override) ? { owner: override, reason: "salvo" } : basePlacement;
        const tasks = tasksByUser.get(client.userId) ?? [];
        return {
          ...row,
          step,
          placement,
          health: crmHealth({
            access: client.access,
            stage: journey.stage,
            metaBroken: client.meta.health === "token_invalido" || client.meta.health === "erro_checagem",
            publishHolds: client.publishHolds,
            criticalStep: step?.tone === "critical",
            matRecommendations: row.alerts.filter((alert) => alert.family === "playbook").length,
          }),
          openTask: tasks.find((task) => !task.closed) ?? null,
          lastDone: tasks.find((task) => task.closed || task.done) ?? null,
          mat: crmMatDraft({
            access: client.access,
            firstName: client.name?.split(/\s+/)[0] ?? null,
            tags: journey.tags.map((tag) => tag.key),
          }),
        };
      }),
    [rows, stopped, store.goals, moved, tasksByUser],
  );

  const searched = useMemo(() => cards.filter(({ client }) => matchesSearch(client, search.trim())), [cards, search]);
  const planCounts = useMemo(() => {
    const counts: Record<string, number> = { all: searched.length, premium: 0, pro: 0, starter: 0 };
    for (const { client } of searched) counts[planGroupOf(client.plan.tier)] += 1;
    return counts;
  }, [searched]);
  const visible = searched.filter(({ client }) => !plan || planGroupOf(client.plan.tier) === plan);
  const owners = ownerFilter ? CRM_OWNERS.filter((owner) => owner.key === ownerFilter) : CRM_OWNERS;

  function setParam(key: string, value: string | null) {
    replaceParams((query) => {
      if (value) query.set(key, value);
      else query.delete(key);
    });
  }

  async function move(card: Card, to: CrmOwnerKey, task?: { done: string; todo: string; closeTaskId?: string }) {
    const target = crmOwner(to)!;
    if (!canMoveTo(card.client.access, to)) {
      toast.error("Plano vencido ou atrasado fica com o Gui até regularizar.");
      return false;
    }
    try {
      if (task?.closeTaskId) {
        await apply({ op: "completeTask", userId: card.client.userId, taskId: task.closeTaskId, note: task.done });
      }
      if (to !== card.placement.owner || task?.todo || (!task?.closeTaskId && task?.done)) {
        await apply({ op: "moveCard", userId: card.client.userId, to, done: task?.done, todo: task?.todo });
        setMoved((current) => new Map(current).set(card.client.userId, to));
      }
      toast.success(
        to === card.placement.owner ? `Registrado em ${card.client.displayName}` : `${card.client.displayName} foi para ${target.label}`,
      );
      return true;
    } catch {
      return false; // o toast de erro vem do useWorkspaceState
    }
  }

  const openMessage = (row: JourneyRow) =>
    setComposer({ client: row.client, journey: row.journey, templateKey: primaryTemplateKey(row.journey, row.client) });

  const filtersActive = Boolean(search.trim() || plan || ownerFilter);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="space-y-2 px-4 pt-3 pb-2 lg:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-base font-semibold tracking-tight whitespace-nowrap">CRM</h1>
            <p className="truncate text-xs text-muted-foreground" title={`Gasto até ontem (${range.days} dias)`}>
              {plural(visible.length, "cliente", "clientes")} · arraste o card para trocar o responsável
            </p>
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente, e-mail ou telefone"
              className="h-7 pl-8 text-xs"
              aria-label="Buscar cliente"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <ChipGroup label="Plano">
            {PLAN_FILTERS.map((option) => (
              <Chip key={option.label} active={plan === option.key} onClick={() => setParam("plano", option.key)}>
                {option.label}
                <span className="tabular-nums text-muted-foreground">{planCounts[option.key ?? "all"]}</span>
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label="Responsável">
            <Chip active={!ownerFilter} onClick={() => setParam("responsavel", null)}>
              Todos
            </Chip>
            {CRM_OWNERS.map((owner) => (
              <Chip key={owner.key} active={ownerFilter === owner.key} onClick={() => setParam("responsavel", owner.key)}>
                {owner.label}
                {owner.key === mine ? <span className="text-muted-foreground">(você)</span> : null}
              </Chip>
            ))}
          </ChipGroup>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                replaceParams((query) => {
                  query.delete("plano");
                  query.delete("responsavel");
                });
                setSearch("");
              }}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" /> Limpar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 lg:px-6",
          owners.length === 1 ? "grid-cols-1" : "auto-cols-[minmax(280px,1fr)] grid-flow-col",
        )}
      >
        {owners.map((owner) => {
          const columnCards = visible.filter((card) => card.placement.owner === owner.key);
          return (
            <OwnerColumn
              key={owner.key}
              ownerKey={owner.key}
              label={owner.label}
              role={owner.role}
              isMine={owner.key === mine}
              cards={columnCards}
              dragOver={dragOver === owner.key}
              onDragOver={(over) => setDragOver(over ? owner.key : null)}
              onDrop={(userId) => {
                setDragOver(null);
                const card = cards.find((entry) => entry.client.userId === userId);
                if (!card || card.placement.owner === owner.key) return;
                if (!canMoveTo(card.client.access, owner.key)) {
                  toast.error("Plano vencido ou atrasado fica com o Gui até regularizar.");
                  return;
                }
                setPassing({ card, to: owner.key });
              }}
              renderCard={(card) => (
                <ClientCard
                  key={card.client.userId}
                  card={card}
                  now={now}
                  onMessage={openMessage}
                  onPass={() => setPassing({ card, to: null })}
                  onMat={() => setMat(card)}
                />
              )}
            />
          );
        })}
      </div>

      <TemplateComposerDialog target={composer} onClose={() => setComposer(null)} />
      <OutreachDialog
        open={mat != null}
        onOpenChange={(open) => (open ? null : setMat(null))}
        userId={mat?.client.userId ?? ""}
        clientName={mat?.client.displayName ?? ""}
        draft={mat?.mat ?? null}
        lastMatSentAt={mat?.mat ? lastMatSentAt(store, mat.client.userId, mat.mat.kind) : null}
      />
      {passing ? (
        <PassCardDialog
          key={`${passing.card.client.userId}-${passing.to ?? ""}`}
          card={passing.card}
          initialTo={passing.to}
          saving={isSaving}
          onClose={() => setPassing(null)}
          onSubmit={async (to, task) => {
            if (await move(passing.card, to, task)) setPassing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function lastMatSentAt(store: WorkspaceState, userId: string, kind: string): string | null {
  let last: string | null = null;
  for (const message of store.sentMessages) {
    if (message.userId !== userId || message.templateKey !== `${MAT_TEMPLATE_PREFIX}${kind}`) continue;
    if (!last || message.at > last) last = message.at;
  }
  return last;
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="mr-1 text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 whitespace-nowrap transition-colors hover:bg-muted",
        active && "border-foreground/30 bg-foreground text-background hover:bg-foreground/90 [&_span]:text-background/70",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Coluna de um responsável                                            */
/* ------------------------------------------------------------------ */

function OwnerColumn({
  ownerKey,
  label,
  role,
  isMine,
  cards,
  dragOver,
  onDragOver,
  onDrop,
  renderCard,
}: {
  ownerKey: CrmOwnerKey;
  label: string;
  role: string;
  isMine: boolean;
  cards: Card[];
  dragOver: boolean;
  onDragOver: (over: boolean) => void;
  onDrop: (userId: string) => void;
  renderCard: (card: Card) => React.ReactNode;
}) {
  const groups = CRM_HEALTH_ORDER.map((health) => ({
    health,
    cards: cards
      .filter((card) => card.health === health)
      .sort(
        (a, b) =>
          Number(Boolean(b.openTask)) - Number(Boolean(a.openTask)) ||
          PLAN_RANK[a.client.plan.tier] - PLAN_RANK[b.client.plan.tier] ||
          b.client.perf.current.spend - a.client.perf.current.spend,
      ),
  })).filter((group) => group.cards.length > 0);
  const openTasks = cards.filter((card) => card.openTask).length;

  return (
    <section
      aria-labelledby={`crm-${ownerKey}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (!dragOver) onDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const userId = event.dataTransfer.getData("text/plain");
        if (userId) onDrop(userId);
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-col rounded-xl border bg-muted/30 transition-colors",
        isMine && "border-primary/40",
        dragOver && "border-primary bg-primary/5",
      )}
    >
      <header className="border-b px-3 py-2">
        <h2 id={`crm-${ownerKey}`} className="flex items-center gap-2 text-sm font-semibold">
          {label}
          {isMine ? <span className="text-[11px] font-normal text-muted-foreground">você</span> : null}
          <span className="rounded-full bg-background px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
            {cards.length}
          </span>
          {openTasks > 0 ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-normal text-violet-700 dark:text-violet-300">
              <ClipboardCheck className="size-3" /> {plural(openTasks, "tarefa", "tarefas")}
            </span>
          ) : null}
        </h2>
        <p className="truncate text-[11px] text-muted-foreground">{role}</p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            Ninguém aqui com esses filtros.
          </p>
        ) : (
          groups.map((group) => <HealthGroup key={group.health} health={group.health} cards={group.cards} render={renderCard} />)
        )}
      </div>
    </section>
  );
}

function HealthGroup({ health, cards, render }: { health: CrmHealth; cards: Card[]; render: (card: Card) => React.ReactNode }) {
  const [open, setOpen] = useState(health !== "ok");
  const [expanded, setExpanded] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  const shown = expanded ? cards : cards.slice(0, GROUP_PREVIEW);
  const rest = cards.length - GROUP_PREVIEW;
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs hover:bg-muted/60"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn("size-2 shrink-0 rounded-full", HEALTH_DOT[health])} aria-hidden />
        <span className="font-semibold">{CRM_HEALTH_LABEL[health]}</span>
        <span className="tabular-nums text-muted-foreground">({cards.length})</span>
      </button>
      {open ? (
        <>
          <ul className="space-y-1.5">{shown.map(render)}</ul>
          {rest > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="w-full rounded-md py-1 text-center text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              {expanded ? "ver menos" : `ver mais ${rest}`}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

function ClientCard({
  card,
  now,
  onMessage,
  onPass,
  onMat,
}: {
  card: Card;
  now: number;
  onMessage: (row: JourneyRow) => void;
  onPass: () => void;
  onMat: () => void;
}) {
  const { client, step, openTask, lastDone } = card;
  const status = planStatus(client, now);
  const from = openTask ? crmOwnerByEmail(openTask.by)?.label ?? openTask.by.split("@")[0] : null;
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", client.userId);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="group cursor-grab rounded-lg border bg-card px-2.5 py-2 shadow-xs transition-colors hover:border-foreground/25 active:cursor-grabbing"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href={clientHref(client.userId)}
          title={client.displayName}
          className="min-w-0 truncate text-sm leading-5 font-medium hover:underline"
          draggable={false}
        >
          {client.displayName}
        </Link>
        <PlanText tier={client.plan.tier} />
        <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_TONE[status.tone])}>
          {status.label}
        </span>
      </div>

      <p className="mt-0.5 flex min-w-0 items-start gap-1.5 text-[12.5px] leading-snug">
        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", HEALTH_DOT[card.health])} aria-hidden />
        <span className="line-clamp-2" title={step?.text ?? CRM_HEALTH_LABEL[card.health]}>
          {card.health === "ok" ? "Tudo 100% ok" : (step?.text ?? CRM_HEALTH_LABEL[card.health])}
        </span>
      </p>

      {status.dates ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">{status.dates}</p> : null}

      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {client.phone ? (
          <ContactLink
            icon={Phone}
            text={formatPhone(client.phone)}
            href={whatsappHref(client.phone)}
            title="Abrir no WhatsApp"
            onCopy={() => copy(client.phone!, "Telefone")}
          />
        ) : null}
        <ContactLink
          icon={Mail}
          text={client.email}
          href={`mailto:${client.email}`}
          title="Mandar e-mail"
          onCopy={() => copy(client.email, "E-mail")}
        />
      </div>

      {openTask ? (
        <div className="mt-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11.5px] leading-snug dark:border-violet-900 dark:bg-violet-950/40">
          <p className="text-violet-800 dark:text-violet-200">
            <span className="font-medium">Tarefa{from ? ` de ${from}` : ""}:</span> {openTask.todo}
          </p>
          {openTask.done ? <p className="mt-0.5 text-muted-foreground">Feito antes: {openTask.done}</p> : null}
        </div>
      ) : lastDone ? (
        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={lastDone.closed?.note ?? lastDone.done}>
          <Check className="mr-0.5 inline size-3" />
          Última: {lastDone.closed?.note ?? lastDone.done}
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={onPass}>
          {openTask ? <ClipboardCheck className="size-3" /> : <ArrowRightLeft className="size-3" />}
          {openTask ? "Concluir tarefa" : "Passar"}
        </Button>
        {card.mat ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px] text-violet-700 dark:text-violet-300"
            onClick={onMat}
            title={`Mandar pela Mat: ${card.mat.title}`}
          >
            <Bot className="size-3" /> Pela Mat
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto h-6 px-1.5 text-[11px]" onClick={() => onMessage(card)}>
          <MessageSquare className="size-3" /> Mensagem
        </Button>
      </div>
    </li>
  );
}

function ContactLink({
  icon: Icon,
  text,
  href,
  title,
  onCopy,
}: {
  icon: typeof Phone;
  text: string;
  href: string;
  title: string;
  onCopy: () => void;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-0.5">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title}
        draggable={false}
        className="inline-flex min-w-0 items-center gap-1 hover:text-foreground hover:underline"
      >
        <Icon className="size-3 shrink-0" />
        <span className="truncate">{text}</span>
      </a>
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copiar ${text}`}
        title="Copiar"
        className="inline-flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted hover:text-foreground"
      >
        <Copy className="size-2.5" />
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Registrar o que foi feito e passar o card                           */
/* ------------------------------------------------------------------ */

function PassCardDialog({
  card,
  initialTo,
  saving,
  onClose,
  onSubmit,
}: {
  card: Card;
  initialTo: CrmOwnerKey | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (to: CrmOwnerKey, task: { done: string; todo: string; closeTaskId?: string }) => Promise<void>;
}) {
  const current = card.placement.owner;
  const [to, setTo] = useState<CrmOwnerKey>(initialTo ?? current);
  const [done, setDone] = useState("");
  const [todo, setTodo] = useState("");
  const target = crmOwner(to)!;
  const passing = to !== current;
  const closing = card.openTask;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{card.client.displayName}</DialogTitle>
          <DialogDescription>
            Registre o que foi feito e, se for o caso, mande o card para quem continua — com a próxima tarefa.
          </DialogDescription>
        </DialogHeader>

        {closing ? (
          <div className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs dark:border-violet-900 dark:bg-violet-950/40">
            <span className="font-medium">Tarefa aberta:</span> {closing.todo}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="crm-done" className="text-xs">
              {closing ? "Como você resolveu" : "O que você fez"}
            </Label>
            <Textarea
              id="crm-done"
              value={done}
              onChange={(event) => setDone(event.target.value)}
              placeholder="Ex.: corrigi o pixel, evento Compra voltou a disparar"
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium">Card fica com</span>
            <div className="flex flex-wrap gap-1">
              {CRM_OWNERS.map((owner) => {
                const allowed = canMoveTo(card.client.access, owner.key);
                return (
                  <button
                    key={owner.key}
                    type="button"
                    disabled={!allowed}
                    onClick={() => setTo(owner.key)}
                    aria-pressed={to === owner.key}
                    title={allowed ? owner.role : "Plano vencido ou atrasado fica com o Gui até regularizar"}
                    className={cn(
                      "h-7 rounded-md border px-2.5 text-xs transition-colors hover:bg-muted disabled:opacity-40",
                      to === owner.key && "border-foreground bg-foreground text-background hover:bg-foreground/90",
                    )}
                  >
                    {owner.label}
                    {owner.key === current ? " (atual)" : ""}
                  </button>
                );
              })}
            </div>
          </div>

          {passing ? (
            <div className="space-y-1.5">
              <Label htmlFor="crm-todo" className="text-xs">
                O que {target.label} deve fazer
              </Label>
              <Textarea
                id="crm-todo"
                value={todo}
                onChange={(event) => setTodo(event.target.value)}
                placeholder="Ex.: avisar o cliente que o pixel foi corrigido"
                rows={2}
                className="text-sm"
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={saving || (!passing && !done.trim() && !closing)}
            onClick={() => void onSubmit(to, { done: done.trim(), todo: todo.trim(), closeTaskId: closing?.id })}
          >
            {passing ? `Passar para ${target.label}` : closing ? "Concluir tarefa" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
