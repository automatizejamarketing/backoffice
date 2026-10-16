"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleCheck, ExternalLink, MessageSquare, Tags, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { cn } from "@/lib/utils";
import {
  PROBLEM_TAGS,
  PROBLEM_TAG_BY_KEY,
  TEMPLATE_BY_KEY,
  type ClientJourney,
  type ProblemTag,
} from "@/lib/consultant-workspace/journey";
import type { WorkspaceState } from "@/lib/consultant-workspace/types";
import { useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";
import { ProblemTagChip } from "@/components/consultant-workspace/common/journey-bits";

const TAG_OPTIONS = PROBLEM_TAGS.map((tag) => ({ value: tag.key, label: tag.label }));

/** Passos numerados com caixinha — marcar é só desta tela (não grava). */
export function ChecklistSteps({ steps, idPrefix }: { steps: string[]; idPrefix: string }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  return (
    <ol className="space-y-1.5">
      {steps.map((step, index) => {
        const checked = done.has(index);
        return (
          <li key={`${idPrefix}-${index}`}>
            <button
              type="button"
              onClick={() =>
                setDone((current) => {
                  const next = new Set(current);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
              aria-pressed={checked}
              className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted/50"
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] font-semibold tabular-nums",
                  checked ? "border-emerald-500 bg-emerald-500 text-white" : "border-input text-muted-foreground",
                )}
              >
                {checked ? <Check className="size-3" /> : index + 1}
              </span>
              <span className={cn("text-sm leading-snug", checked && "text-muted-foreground line-through")}>{step}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function ProblemTagsPanel({
  userId,
  journey,
  store,
  onMessage,
}: {
  userId: string;
  journey: ClientJourney;
  store: WorkspaceState;
  onMessage: (templateKey: string) => void;
}) {
  const { apply, isSaving } = useWorkspaceState();
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set(journey.tags.slice(0, 1).map((tag) => tag.key)));
  const autoTags = new Set(journey.autoTags);
  const manualTags = journey.manualTags;
  const dismissed = (store.dismissedAutoTags[userId] ?? [])
    .map((key) => PROBLEM_TAG_BY_KEY.get(key))
    .filter((tag): tag is ProblemTag => Boolean(tag));

  async function setManual(next: string[]) {
    await apply({ op: "setClientTags", userId, tags: next }).catch(() => undefined);
  }

  async function resolve(tag: ProblemTag) {
    try {
      if (autoTags.has(tag.key)) {
        await apply({ op: "dismissAutoTag", userId, tag: tag.key, dismissed: true });
      }
      if (manualTags.includes(tag.key)) {
        await apply({ op: "setClientTags", userId, tags: manualTags.filter((key) => key !== tag.key) });
      }
      toast.success(`“${tag.label}” marcado como resolvido`);
    } catch {
      // o erro já apareceu no aviso
    }
  }

  function toggle(key: string) {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Tags className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Problemas e playbooks</h2>
        <span className="text-xs text-muted-foreground">
          {journey.tags.length === 0 ? "nenhum ativo" : `${journey.tags.length} ativo${journey.tags.length > 1 ? "s" : ""}`}
        </span>
        <MultiSelect
          label="Tags manuais"
          options={TAG_OPTIONS}
          value={manualTags}
          onValueChange={setManual}
          allLabel="nenhuma"
          searchPlaceholder="Buscar problema…"
          className="ml-auto h-7 min-w-0 text-xs"
          disabled={isSaving}
        />
      </div>

      {journey.tags.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground">
          Nada travando por enquanto. Quando algo travar, marque a tag — cada uma traz o playbook de resolução e a
          mensagem pronta para o cliente.
        </p>
      ) : (
        <ul className="divide-y">
          {journey.tags.map((tag) => {
            const open = openKeys.has(tag.key);
            const isAuto = autoTags.has(tag.key);
            const template = tag.templateKey ? TEMPLATE_BY_KEY.get(tag.templateKey) : null;
            const Icon = open ? ChevronDown : ChevronRight;
            return (
              <li key={tag.key}>
                <button
                  type="button"
                  onClick={() => toggle(tag.key)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <ProblemTagChip tag={tag} auto={isAuto} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {isAuto ? "detectado pelos dados" : "marcado à mão"} · {tag.playbook.length} passos
                  </span>
                </button>
                {open ? (
                  <div className="space-y-3 px-3 pt-1 pb-3 pl-9">
                    <p className="text-sm text-muted-foreground">{tag.description}</p>
                    <ChecklistSteps steps={tag.playbook} idPrefix={tag.key} />
                    <div className="flex flex-wrap items-center gap-1.5">
                      {template ? (
                        <Button size="xs" onClick={() => onMessage(template.key)}>
                          <MessageSquare /> Mandar mensagem · {template.label}
                        </Button>
                      ) : null}
                      {tag.link ? (
                        <Button size="xs" variant="outline" asChild>
                          <a href={tag.link.href} target="_blank" rel="noreferrer">
                            {tag.link.label} <ExternalLink />
                          </a>
                        </Button>
                      ) : null}
                      <Button size="xs" variant="ghost" onClick={() => resolve(tag)} disabled={isSaving}>
                        {isAuto ? <CircleCheck /> : <X />} {isAuto ? "Resolvido" : "Remover tag"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {dismissed.length > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2 text-[11px] text-muted-foreground">
          Marcadas como resolvidas:
          {dismissed.map((tag) => (
            <button
              key={tag.key}
              type="button"
              disabled={isSaving}
              onClick={() =>
                void apply({ op: "dismissAutoTag", userId, tag: tag.key, dismissed: false }).catch(() => undefined)
              }
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:text-foreground"
              title="Voltar a mostrar se os dados ainda indicarem"
            >
              {tag.label} <Undo2 className="size-3" />
            </button>
          ))}
        </p>
      ) : null}
    </section>
  );
}
