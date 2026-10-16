"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { SeverityDot } from "@/components/consultant-workspace/shared/primitives";
import { snoozeUntil } from "@/components/consultant-workspace/shared/actions";
import { useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";
import { cn } from "@/lib/utils";
import { ALERT_OUTCOME_LABEL, type AlertOutcome, type NoteKind } from "@/lib/consultant-workspace/types";
import { groupSignals, type Signal } from "@/components/consultant-workspace/common/model";
import { entityLabel, formatDateShort, isSyntheticKey } from "@/components/consultant-workspace/common/signal-helpers";

/**
 * Concluir / Adiar / Nota — para um cliente (Fila, painel) ou vários de uma
 * vez (seleção da Mesa). Concluir exige dizer o que foi feito; a nota vai
 * para o histórico de cada cliente.
 */

export type ActionTarget = { userId: string; name: string; signals: Signal[]; actionIds: string[] };

function titleFor(verb: string, targets: ActionTarget[]) {
  return targets.length === 1 ? `${verb} · ${targets[0].name}` : `${verb} · ${targets.length} clientes`;
}

function TargetSummary({ targets }: { targets: ActionTarget[] }) {
  const withSignals = targets.filter((target) => target.actionIds.length > 0);
  if (targets.length === 1) {
    const closing = targets[0].signals.filter((signal) => targets[0].actionIds.includes(signal.key));
    return (
      <ul className="max-h-48 space-y-1 overflow-x-hidden overflow-y-auto rounded-md border bg-muted/40 p-2.5 text-sm">
        {groupSignals(closing).map(({ id, signals }) => (
          <li key={id} className="flex min-w-0 items-center gap-2">
            <SeverityDot severity={signals[0].severity} />
            <span className="min-w-0 truncate">
              {signals[0].title}
              {signals.length > 1 ? <span className="text-muted-foreground"> × {signals.length}</span> : null}
            </span>
            {isSyntheticKey(signals[0].key) ? (
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">volta em 3 dias se continuar</span>
            ) : signals.length === 1 && entityLabel(signals[0]) ? (
              <span className="ml-auto max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">
                {entityLabel(signals[0])}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  const shown = withSignals.slice(0, 8);
  const skipped = targets.length - withSignals.length;
  return (
    <div className="min-w-0 space-y-1.5">
      <ul className="max-h-56 space-y-1 overflow-x-hidden overflow-y-auto rounded-md border bg-muted/40 p-2.5 text-sm">
        {shown.map((target) => {
          const groups = groupSignals(target.signals.filter((signal) => target.actionIds.includes(signal.key)));
          return (
            <li key={target.userId} className="flex min-w-0 items-baseline gap-2">
              <span className="max-w-[45%] shrink-0 truncate font-medium">{target.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {groups.map((group) => `${group.signals[0].title}${group.signals.length > 1 ? ` ×${group.signals.length}` : ""}`).join(" · ")}
              </span>
            </li>
          );
        })}
        {withSignals.length > shown.length ? (
          <li className="text-xs text-muted-foreground">e mais {withSignals.length - shown.length} clientes</li>
        ) : null}
      </ul>
      {skipped > 0 ? (
        <p className="text-xs text-muted-foreground">
          {skipped === 1 ? "1 cliente selecionado não tem" : `${skipped} clientes selecionados não têm`} sinal aberto —{" "}
          {skipped === 1 ? "fica" : "ficam"} de fora.
        </p>
      ) : null}
    </div>
  );
}

const OUTCOMES = (Object.keys(ALERT_OUTCOME_LABEL) as AlertOutcome[]).filter((value) => value !== "falso_alarme");

export function ResolveDialog({
  targets,
  onOpenChange,
  onDone,
}: {
  targets: ActionTarget[];
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { apply } = useWorkspaceState();
  const [outcome, setOutcome] = useState<AlertOutcome | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const actionable = targets.filter((target) => target.actionIds.length > 0);
  const signalCount = actionable.reduce((sum, target) => sum + target.actionIds.length, 0);

  async function submit(status: "done" | "dismissed") {
    if (busy) return;
    if (status === "done" && !outcome) {
      toast.error("Escolha o que foi feito");
      return;
    }
    if (actionable.length === 0) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      const text = note.trim() || (status === "done" && outcome ? ALERT_OUTCOME_LABEL[outcome] : null);
      for (const target of actionable) {
        await apply({
          op: "alertAction",
          insightIds: target.actionIds,
          userId: target.userId,
          status,
          outcome: status === "done" ? outcome : "falso_alarme",
          note: text,
        });
      }
      toast.success(
        actionable.length === 1
          ? `${actionable[0].name}: ${signalCount === 1 ? "sinal tratado" : `${signalCount} sinais tratados`}`
          : `${actionable.length} clientes tratados (${signalCount} sinais)`,
      );
      onOpenChange(false);
      onDone?.();
    } catch {
      // o erro já apareceu no aviso; o diálogo fica aberto para tentar de novo
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="min-w-0 sm:max-w-lg"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLTextAreaElement) {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit("done");
            }
            return;
          }
          const index = Number(event.key) - 1;
          if (index >= 0 && index < OUTCOMES.length) {
            event.preventDefault();
            setOutcome(OUTCOMES[index]);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{titleFor("Concluir", targets)}</DialogTitle>
          <DialogDescription>
            {actionable.length === 0
              ? "Nenhum sinal aberto para fechar."
              : `Fecha ${signalCount === 1 ? "1 sinal" : `${signalCount} sinais`}${actionable.length > 1 ? ` de ${actionable.length} clientes` : ""}. O que você escrever vai para o histórico ${actionable.length > 1 ? "de cada cliente" : "do cliente"}.`}
          </DialogDescription>
        </DialogHeader>
        <TargetSummary targets={targets} />
        <div className="space-y-2">
          <p className="text-xs font-medium">O que foi feito?</p>
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((value, index) => (
              <button
                key={value}
                type="button"
                onClick={() => setOutcome(value)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                  outcome === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <kbd className="font-mono text-[10px] opacity-60">{index + 1}</kbd>
                {ALERT_OUTCOME_LABEL[value]}
              </button>
            ))}
          </div>
          <Textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="O que você fez ou combinou (opcional, vai para o histórico)"
            className="text-sm"
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <span className="self-center text-[11px] text-muted-foreground">1–5 escolhe · ⌘↵ conclui</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => submit("dismissed")} disabled={busy || actionable.length === 0}>
              Falso alarme
            </Button>
            <Button onClick={() => submit("done")} disabled={busy || actionable.length === 0}>
              Concluir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nextMondayDays(now: number) {
  const day = new Date(now).getDay();
  return (8 - day) % 7 || 7;
}

export function SnoozeDialog({
  targets,
  now,
  onOpenChange,
  onDone,
}: {
  targets: ActionTarget[];
  now: number;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { apply } = useWorkspaceState();
  const [busy, setBusy] = useState(false);
  const actionable = targets.filter((target) => target.actionIds.length > 0);
  const options = [
    { key: "1", label: "Amanhã", days: 1 },
    { key: "2", label: "Em 3 dias", days: 3 },
    { key: "3", label: "Próxima semana", days: nextMondayDays(now) },
  ];

  async function snooze(days: number) {
    if (busy) return;
    if (actionable.length === 0) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    try {
      const until = snoozeUntil(days);
      for (const target of actionable) {
        await apply({
          op: "alertAction",
          insightIds: target.actionIds,
          userId: target.userId,
          status: "snoozed",
          snoozeUntil: until,
          note: null,
        });
      }
      toast.success(
        `${actionable.length === 1 ? actionable[0].name : `${actionable.length} clientes`} adiado${actionable.length === 1 ? "" : "s"} até ${formatDateShort(until)}`,
      );
      onOpenChange(false);
      onDone?.();
    } catch {
      // o erro já apareceu no aviso; o diálogo fica aberto para tentar de novo
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-sm"
        onKeyDown={(event) => {
          const option = options.find((item) => item.key === event.key);
          if (option) {
            event.preventDefault();
            void snooze(option.days);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{titleFor("Adiar", targets)}</DialogTitle>
          <DialogDescription>
            {actionable.length === 0
              ? "Nenhum sinal aberto para adiar."
              : "Sai da fila agora e volta sozinho às 8h do dia escolhido."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={busy || actionable.length === 0}
              onClick={() => snooze(option.days)}
              className="flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm hover:border-primary hover:bg-primary/5 disabled:opacity-50"
            >
              <kbd className="rounded border bg-muted px-1.5 font-mono text-[11px]">{option.key}</kbd>
              <span className="flex-1">{option.label}</span>
              <span className="text-xs text-muted-foreground">{formatDateShort(snoozeUntil(option.days))}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const NOTE_KINDS: Array<{ value: NoteKind; label: string }> = [
  { value: "contato", label: "Contato com o cliente" },
  { value: "nota", label: "Nota interna" },
  { value: "reuniao", label: "Reunião" },
];

export function NoteDialog({
  targets,
  defaultKind = "contato",
  onOpenChange,
}: {
  targets: ActionTarget[];
  defaultKind?: NoteKind;
  onOpenChange: (open: boolean) => void;
}) {
  const { apply } = useWorkspaceState();
  const [kind, setKind] = useState<NoteKind>(defaultKind);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      for (const target of targets) {
        await apply({ op: "addNote", userId: target.userId, kind, text: text.trim() });
      }
      toast.success(targets.length === 1 ? "Registrado no histórico" : `Registrado no histórico de ${targets.length} clientes`);
      onOpenChange(false);
    } catch {
      // o erro já apareceu no aviso; o diálogo fica aberto para tentar de novo
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titleFor("Registrar", targets)}</DialogTitle>
          <DialogDescription>
            Fica na linha do tempo {targets.length > 1 ? "de cada cliente" : "do cliente"} e zera o contador de “último
            toque”.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {NOTE_KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                kind === option.value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Textarea
          autoFocus
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ex.: Liguei, o cliente vai trocar a oferta na sexta."
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
          }}
        />
        <DialogFooter>
          <span className="mr-auto self-center text-[11px] text-muted-foreground">⌘↵ para salvar</span>
          <Button onClick={save} disabled={busy || !text.trim()}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const HELP_COMMON: Array<[string, string]> = [
  ["j / ↓", "Próximo cliente"],
  ["k / ↑", "Cliente anterior"],
  ["e", "Concluir (diz o que foi feito; vai para o histórico)"],
  ["s", "Adiar: 1 amanhã · 2 em 3 dias · 3 próxima semana"],
  ["n", "Registrar nota, contato ou reunião"],
  ["m", "Definir ou editar a meta"],
  ["/", "Buscar"],
  ["?", "Esta lista"],
];

export function HelpDialog({ mode, onOpenChange }: { mode: "fila" | "tabela"; onOpenChange: (open: boolean) => void }) {
  const specific: Array<[string, string]> =
    mode === "fila"
      ? [
          ["↵ / o", "Abrir a página do cliente"],
          ["a", "Mostrar/esconder o automático e outras áreas"],
        ]
      : [
          ["↵", "Abrir o painel do cliente ao lado"],
          ["o", "Abrir a página do cliente"],
          ["x", "Marcar/desmarcar a linha (e, s, n valem para todas as marcadas)"],
          ["Esc", "Fechar o painel / limpar seleção"],
        ];
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" /> Atalhos da {mode === "fila" ? "Fila" : "Mesa"}
          </DialogTitle>
          <DialogDescription>Não disparam enquanto você digita em um campo.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {[...HELP_COMMON.slice(0, 2), ...specific, ...HELP_COMMON.slice(2)].map(([key, label]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">{key}</kbd>
              </dt>
              <dd className="text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
