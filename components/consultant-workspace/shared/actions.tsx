"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GOAL_KPI_LABEL, goalKpiForKind } from "@/lib/consultant-workspace/metrics";
import {
  ALERT_OUTCOME_LABEL,
  type AlertOutcome,
  type GoalKpi,
  type PrimaryKpi,
  type WorkspaceGoal,
  type WorkspaceSimulatedAction,
} from "@/lib/consultant-workspace/types";
import { useWorkspaceState } from "./use-workspace-state";

/** Meta do cliente: KPI-alvo + verba mensal combinada. */
export function GoalEditorDialog({
  open,
  onOpenChange,
  userId,
  clientName,
  kpi,
  goal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  clientName: string;
  kpi: PrimaryKpi;
  goal: WorkspaceGoal | undefined;
}) {
  const { apply, isSaving } = useWorkspaceState();
  const suggested = goal?.kpi ?? goalKpiForKind(kpi.kind);
  const [kpiKind, setKpiKind] = useState<GoalKpi>(suggested);
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [budget, setBudget] = useState(goal?.monthlyBudget ? String(goal.monthlyBudget) : "");

  const options: GoalKpi[] =
    kpi.kind === "compras" ? ["cpa", "roas"] : [goalKpiForKind(kpi.kind), "custo_resultado"];

  async function save() {
    const value = Number(target.replace(",", "."));
    if (!value || value <= 0) {
      toast.error("Informe o alvo");
      return;
    }
    await apply({
      op: "setGoal",
      userId,
      goal: {
        kpi: kpiKind,
        target: value,
        monthlyBudget: budget ? Number(budget.replace(",", ".")) : null,
      },
    });
    toast.success("Meta salva");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Meta de {clientName}</DialogTitle>
          <DialogDescription>
            O que foi combinado com o cliente. Alertas, cores e ritmo de verba passam a ser
            medidos contra isso.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Indicador</Label>
            <div className="flex flex-wrap gap-2">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKpiKind(option)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-sm",
                    kpiKind === option ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                  )}
                >
                  {GOAL_KPI_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="goal-target">{kpiKind === "roas" ? "ROAS mínimo (x)" : "Alvo (R$)"}</Label>
              <Input
                id="goal-target"
                inputMode="decimal"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={kpiKind === "roas" ? "3" : "15,00"}
              />
              {kpi.cost != null && kpiKind !== "roas" ? (
                <p className="text-xs text-muted-foreground">
                  Atual: R$ {kpi.cost.toFixed(2).replace(".", ",")}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-budget">Verba mensal (R$)</Label>
              <Input
                id="goal-budget"
                inputMode="decimal"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                placeholder="3000"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          {goal ? (
            <Button
              variant="ghost"
              onClick={async () => {
                await apply({ op: "clearGoal", userId });
                onOpenChange(false);
              }}
            >
              Remover meta
            </Button>
          ) : null}
          <Button onClick={save} disabled={isSaving}>
            Salvar meta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOMES = Object.keys(ALERT_OUTCOME_LABEL) as AlertOutcome[];

/**
 * Concluir alerta exigindo o que foi feito. A nota vira item da linha do tempo
 * do cliente — o próximo consultor sabe o que aconteceu.
 */
export function ResolveAlertForm({
  userId,
  insightIds,
  onDone,
  compact,
}: {
  userId: string;
  insightIds: string[];
  onDone?: () => void;
  compact?: boolean;
}) {
  const { apply, isSaving } = useWorkspaceState();
  const [outcome, setOutcome] = useState<AlertOutcome | null>(null);
  const [note, setNote] = useState("");

  async function submit(status: "done" | "dismissed") {
    if (status === "done" && !outcome) {
      toast.error("Escolha o que foi feito");
      return;
    }
    await apply({
      op: "alertAction",
      insightIds,
      userId,
      status,
      outcome: status === "done" ? outcome : "falso_alarme",
      note: note.trim()
        ? note.trim()
        : status === "done" && outcome
          ? ALERT_OUTCOME_LABEL[outcome]
          : null,
    });
    toast.success(insightIds.length > 1 ? `${insightIds.length} alertas tratados` : "Alerta tratado");
    setOutcome(null);
    setNote("");
    onDone?.();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.filter((value) => value !== "falso_alarme").map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setOutcome(value)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              outcome === value ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ALERT_OUTCOME_LABEL[value]}
          </button>
        ))}
      </div>
      <Textarea
        rows={compact ? 2 : 3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="O que você fez ou combinou (opcional, vai para o histórico do cliente)"
        className="text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => submit("done")} disabled={isSaving}>
          Concluir
        </Button>
        <Button size="sm" variant="ghost" onClick={() => submit("dismissed")} disabled={isSaving}>
          Falso alarme
        </Button>
      </div>
    </div>
  );
}

export function snoozeUntil(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(8, 0, 0, 0);
  return date.toISOString();
}

const ACTION_LABEL: Record<WorkspaceSimulatedAction["action"], string> = {
  pausar: "Pausar",
  ativar: "Ativar",
  orcamento: "Alterar orçamento",
  duplicar: "Duplicar",
  trocar_criativo: "Trocar criativo",
  otimizar: "Otimizar",
};

const META_ACTION: Partial<Record<WorkspaceSimulatedAction["action"], "pause" | "activate" | "set_daily_budget" | "duplicate">> = {
  pausar: "pause",
  ativar: "activate",
  orcamento: "set_daily_budget",
  duplicar: "duplicate",
};

type Preview = { entity: string; from: string | null; to: string | null; warnings: string[]; blocking: string[] };

/**
 * Ação real na Meta: lê o estado ao vivo (prévia), mostra atual → novo e só
 * então aplica, pelas mesmas rotas da tela de Marketing (nota obrigatória e
 * auditoria). "Trocar criativo" e "Otimizar" não mexem na Meta daqui: o
 * primeiro abre o Marketing do cliente, o segundo registra a ação no histórico.
 */
export function MetaActionDialog({
  open,
  onOpenChange,
  userId,
  entityId,
  entityName,
  action,
  currentBudget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  entityId: string;
  entityName: string | null;
  action: WorkspaceSimulatedAction["action"];
  currentBudget?: number | null;
}) {
  const queryClient = useQueryClient();
  const { apply, isSaving } = useWorkspaceState();
  const [budget, setBudget] = useState(currentBudget && action === "orcamento" ? String(currentBudget) : "");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const metaAction = META_ACTION[action];

  function change() {
    return {
      userId,
      entityId,
      action: metaAction!,
      value: action === "orcamento" ? Number(budget.replace(",", ".")) || undefined : undefined,
      note: note.trim(),
    };
  }

  async function call(mode: "preview" | "apply") {
    const response = await fetch("/api/consultant-workspace/meta-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ change: change(), mode }),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; preview?: Preview; summary?: string };
    if (!response.ok || body.ok === false) throw new Error(body.error ?? "Falha ao falar com a Meta");
    return body;
  }

  async function review() {
    if (note.trim().length < 5) {
      toast.error("Explique o motivo — vai para a auditoria e o histórico");
      return;
    }
    setBusy(true);
    try {
      setPreview((await call("preview")).preview ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const body = await call("apply");
      toast.success(body.summary ?? `${ACTION_LABEL[action]} aplicado na Meta`);
      await queryClient.invalidateQueries();
      setPreview(null);
      setNote("");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function registerOnly() {
    if (note.trim().length < 5) {
      toast.error("Descreva o que você fez");
      return;
    }
    await apply({ op: "addNote", userId, kind: "acao", text: `${ACTION_LABEL[action]} · ${entityName ?? entityId}: ${note.trim()}` });
    toast.success("Registrado no histórico");
    setNote("");
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPreview(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {ACTION_LABEL[action]} · {entityName ?? entityId}
          </DialogTitle>
          <DialogDescription>
            {action === "trocar_criativo"
              ? "A troca de criativo é feita no Marketing do cliente (upload da mídia). Registre aqui o que foi trocado."
              : action === "otimizar"
                ? "Registre o ajuste feito — vai para o histórico do cliente."
                : "Muda de verdade na Meta. Primeiro conferimos o estado atual; depois você confirma."}
          </DialogDescription>
        </DialogHeader>
        {action === "orcamento" && !preview ? (
          <div className="space-y-1.5">
            <Label htmlFor="meta-budget">Novo orçamento diário (R$)</Label>
            <Input id="meta-budget" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </div>
        ) : null}
        {!preview ? (
          <div className="space-y-1.5">
            <Label htmlFor="meta-note">{metaAction ? "Motivo" : "O que foi feito"}</Label>
            <Textarea id="meta-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
        ) : (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">{preview.entity}</p>
            {preview.from || preview.to ? (
              <p className="tabular-nums text-muted-foreground">
                {preview.from ?? "—"} → <span className="font-medium text-foreground">{preview.to ?? "—"}</span>
              </p>
            ) : null}
            {preview.warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-700 dark:text-amber-400">
                {warning}
              </p>
            ))}
            {preview.blocking.map((issue) => (
              <p key={issue} className="text-xs text-red-700 dark:text-red-400">
                {issue}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">Motivo: {note}</p>
          </div>
        )}
        <DialogFooter>
          {action === "trocar_criativo" ? (
            <Button variant="outline" asChild>
              <a href={`/users/${userId}?tab=marketing`} target="_blank" rel="noreferrer">
                Abrir Marketing do cliente
              </a>
            </Button>
          ) : null}
          {!metaAction ? (
            <Button onClick={registerOnly} disabled={isSaving}>
              Registrar
            </Button>
          ) : preview ? (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                Voltar
              </Button>
              <Button onClick={confirm} disabled={busy || preview.blocking.length > 0}>
                {busy ? "Aplicando…" : "Confirmar na Meta"}
              </Button>
            </>
          ) : (
            <Button onClick={review} disabled={busy}>
              {busy ? "Consultando a Meta…" : "Revisar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ACTION_LABEL as SIMULATED_ACTION_LABEL };
