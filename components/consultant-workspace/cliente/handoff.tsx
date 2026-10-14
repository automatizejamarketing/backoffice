"use client";

import { useState } from "react";
import { ClipboardList, Handshake, MessageSquare, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Textarea } from "@/components/ui/textarea";
import { PROBLEM_TAGS, TEMPLATE_BY_KEY, type ClientJourney } from "@/lib/consultant-workspace/journey";
import { formatRelative } from "@/lib/consultant-workspace/metrics";
import type { WorkspaceClient, WorkspaceHandoff } from "@/lib/consultant-workspace/types";
import { useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";
import { blockerPlan } from "@/components/consultant-workspace/jornada/lib";
import { ChecklistSteps } from "./tags-panel";

const TAG_OPTIONS = PROBLEM_TAGS.map((tag) => ({ value: tag.key, label: tag.label }));

function formatCallDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/**
 * Passagem de bastão do Fred (call de onboarding) para o gestor de tráfego:
 * o que ele viu, o que ficou combinado e os problemas que já apareceram.
 */
export function HandoffCard({ client, journey }: { client: WorkspaceClient; journey: ClientJourney }) {
  const handoff = journey.handoff;
  const [editing, setEditing] = useState(false);

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Handshake className="size-4 text-sky-600 dark:text-sky-400" />
        <h2 className="text-sm font-semibold">Passagem de bastão do Fred</h2>
        {handoff && !editing ? (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
            <Pencil /> Editar
          </Button>
        ) : null}
      </div>
      {handoff && !editing ? (
        <HandoffView handoff={handoff} />
      ) : (
        <HandoffForm
          key={handoff?.at ?? "novo"}
          client={client}
          journey={journey}
          handoff={handoff}
          onDone={() => setEditing(false)}
          onCancel={handoff ? () => setEditing(false) : undefined}
        />
      )}
    </section>
  );
}

function HandoffView({ handoff }: { handoff: WorkspaceHandoff }) {
  const callDate = formatCallDate(handoff.callDate);
  return (
    <div className="space-y-3 px-3 py-3">
      <div className="space-y-0.5">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Resumo da call</p>
        <p className="text-sm leading-relaxed whitespace-pre-line">{handoff.summary}</p>
      </div>
      {handoff.nextSteps ? (
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Próximos passos</p>
          <p className="text-sm leading-relaxed whitespace-pre-line">{handoff.nextSteps}</p>
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">
        Registrada por {handoff.by} {formatRelative(handoff.at)}
        {callDate ? ` · call em ${callDate}` : ""}
      </p>
    </div>
  );
}

function HandoffForm({
  client,
  journey,
  handoff,
  onDone,
  onCancel,
}: {
  client: WorkspaceClient;
  journey: ClientJourney;
  handoff: WorkspaceHandoff | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { apply, isSaving } = useWorkspaceState();
  const [summary, setSummary] = useState(handoff?.summary ?? "");
  const [nextSteps, setNextSteps] = useState(handoff?.nextSteps ?? "");
  const [callDate, setCallDate] = useState(handoff?.callDate ?? "");
  const [tags, setTags] = useState<string[]>(journey.manualTags);

  async function save() {
    if (!summary.trim()) {
      toast.error("Escreva o resumo da call");
      return;
    }
    try {
      await apply({
        op: "setHandoff",
        userId: client.userId,
        summary: summary.trim(),
        nextSteps: nextSteps.trim(),
        callDate: callDate || null,
        tags,
      });
    } catch {
      return;
    }
    toast.success("Passagem registrada — virou nota no histórico");
    onDone();
  }

  return (
    <div className="space-y-3 px-3 py-3">
      {!handoff ? (
        <p className="rounded-md bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          O Fred ainda não passou o bastão de {client.displayName}. Preencha com ele (ou cole o resumo que ele mandou)
          para ninguém precisar perguntar de novo ao cliente.
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="handoff-summary" className="text-xs">
          Resumo da call
        </Label>
        <Textarea
          id="handoff-summary"
          rows={3}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Ex.: Hamburgueria com delivery próprio, quer vender mais no almoço. Tem BM mas nunca anunciou. Verba de R$ 1.500/mês."
          className="text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="handoff-next" className="text-xs">
          Próximos passos
        </Label>
        <Textarea
          id="handoff-next"
          rows={2}
          value={nextSteps}
          onChange={(event) => setNextSteps(event.target.value)}
          placeholder="Ex.: Conectar o Facebook até sexta; mandar fotos dos 3 combos mais vendidos."
          className="text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="handoff-date" className="text-xs">
            Data da call
          </Label>
          <Input
            id="handoff-date"
            type="date"
            value={callDate}
            onChange={(event) => setCallDate(event.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Tags de problema</Label>
          <MultiSelect
            label="Tags"
            options={TAG_OPTIONS}
            value={tags}
            onValueChange={setTags}
            allLabel="nenhuma"
            searchPlaceholder="Buscar problema…"
            className="h-8 w-full text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            As automáticas (detectadas pelos dados) continuam aparecendo sozinhas.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button size="sm" onClick={save} disabled={isSaving}>
          {handoff ? "Salvar alterações" : "Registrar passagem"}
        </Button>
      </div>
    </div>
  );
}

/** "O que fazer agora" para o passo em que o onboarding travou. */
export function BlockerChecklist({
  client,
  journey,
  onMessage,
}: {
  client: WorkspaceClient;
  journey: ClientJourney;
  onMessage: (templateKey: string) => void;
}) {
  const plan = blockerPlan(journey, client);
  if (!plan || !journey.blocker) return null;
  const template = plan.templateKey ? TEMPLATE_BY_KEY.get(plan.templateKey) : null;
  return (
    <section className="rounded-xl border border-amber-300/70 bg-card dark:border-amber-800/70">
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-200/70 bg-amber-50/60 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/20">
        <ClipboardList className="size-4 text-amber-700 dark:text-amber-400" />
        <h2 className="text-sm font-semibold">O que fazer agora</h2>
        <span className="text-xs text-muted-foreground">
          travado em “{journey.blocker.label}”{plan.tag ? ` · playbook: ${plan.tag.label}` : ""}
        </span>
      </div>
      <div className="space-y-3 px-3 py-3">
        <ChecklistSteps steps={plan.steps} idPrefix={`blocker-${journey.blocker.key}`} />
        <div className="flex flex-wrap items-center gap-2">
          {template ? (
            <Button size="sm" onClick={() => onMessage(template.key)}>
              <MessageSquare className="size-3.5" /> Mandar: {template.label}
            </Button>
          ) : null}
          <p className="text-[11px] text-muted-foreground">Marcar os passos é só nesta tela — serve de roteiro.</p>
        </div>
      </div>
    </section>
  );
}
