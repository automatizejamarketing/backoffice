"use client";

import { useState } from "react";
import { ChevronDown, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PROBLEM_TAGS,
  TEMPLATE_BY_KEY,
  renderTemplate,
  type ClientJourney,
  type ProblemTag,
} from "@/lib/consultant-workspace/journey";
import type { WorkspaceClient } from "@/lib/consultant-workspace/types";
import { useWorkspaceState } from "@/components/consultant-workspace/shared/use-workspace-state";
import { ProblemTagChip } from "@/components/consultant-workspace/common/journey-bits";
import { useMySignature } from "@/components/consultant-workspace/common/workspace-context";

/** Tags de problema no painel da Fila/Mesa: playbook curto, mensagem pronta e marcar/resolver. */
export function ProblemTagsInline({
  client,
  journey,
  dense,
}: {
  client: WorkspaceClient;
  journey: ClientJourney;
  dense?: boolean;
}) {
  const signature = useMySignature();
  const { apply, isSaving } = useWorkspaceState();
  const [open, setOpen] = useState<string | null>(dense ? null : (journey.tags[0]?.key ?? null));
  const [adding, setAdding] = useState(false);
  const autoKeys = new Set(journey.autoTags);
  const available = PROBLEM_TAGS.filter((tag) => !journey.tags.some((active) => active.key === tag.key));

  async function remove(tag: ProblemTag) {
    if (autoKeys.has(tag.key)) {
      await apply({ op: "dismissAutoTag", userId: client.userId, tag: tag.key, dismissed: true });
    } else {
      await apply({
        op: "setClientTags",
        userId: client.userId,
        tags: journey.manualTags.filter((key) => key !== tag.key),
      });
    }
    toast.success(`“${tag.label}” marcada como resolvida`);
  }

  async function add(tag: ProblemTag) {
    await apply({ op: "setClientTags", userId: client.userId, tags: [...journey.manualTags, tag.key] });
    setAdding(false);
    setOpen(tag.key);
  }

  async function copyMessage(templateKey: string) {
    const template = TEMPLATE_BY_KEY.get(templateKey);
    if (!template) return;
    try {
      await navigator.clipboard.writeText(
        renderTemplate(template, client, { consultantName: signature }).replace(/[ \t]{2,}/g, " ").trim(),
      );
      toast.success("Mensagem copiada — cole no WhatsApp do cliente");
    } catch {
      toast.error("Não deu para copiar");
    }
  }

  return (
    <div className="space-y-1.5">
      {journey.tags.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum problema marcado.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {journey.tags.map((tag) => {
            const expanded = open === tag.key;
            return (
              <li key={tag.key} className="px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : tag.key)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    aria-expanded={expanded}
                  >
                    <ProblemTagChip tag={tag} auto={autoKeys.has(tag.key)} />
                    <ChevronDown
                      className={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                    />
                  </button>
                  {tag.templateKey ? (
                    <button
                      type="button"
                      onClick={() => copyMessage(tag.templateKey!)}
                      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary hover:underline"
                      title="Copia a mensagem pronta com o nome do cliente"
                    >
                      <Copy className="size-3" /> Mensagem
                    </button>
                  ) : null}
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void remove(tag).catch(() => undefined)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Resolver ${tag.label}`}
                      >
                        <X className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      Marcar como resolvida
                    </TooltipContent>
                  </Tooltip>
                </div>
                {expanded ? (
                  <div className="mt-1.5 space-y-1 pb-1">
                    <p className="text-xs text-muted-foreground">{tag.description}</p>
                    <ol className="list-decimal space-y-0.5 pl-4 text-xs">
                      {tag.playbook.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <div className="flex flex-wrap gap-1">
          {available.map((tag) => (
            <button
              key={tag.key}
              type="button"
              disabled={isSaving}
              onClick={() => void add(tag).catch(() => undefined)}
              className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
            >
              + {tag.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="px-1 text-[11px] text-muted-foreground hover:underline"
          >
            cancelar
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-[11px] text-primary hover:underline">
          + Marcar problema
        </button>
      )}
    </div>
  );
}
