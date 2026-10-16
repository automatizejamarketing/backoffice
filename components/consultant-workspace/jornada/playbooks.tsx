"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, MessageSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROBLEM_TAGS,
  TEMPLATE_BY_KEY,
  type JourneyExtras,
  type JourneyStage,
} from "@/lib/consultant-workspace/journey";
import type { WorkspaceClient, WorkspaceState } from "@/lib/consultant-workspace/types";
import { useAssignmentOverrides } from "@/components/consultant-workspace/common/assignment";
import { useConsultantScope } from "@/components/consultant-workspace/common/consultant-scope";
import { StageDot } from "@/components/consultant-workspace/common/journey-bits";
import { useRememberView } from "@/components/consultant-workspace/common/last-view";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";
import { useMySignature } from "@/components/consultant-workspace/common/workspace-context";
import { SAMPLE_CLIENT, consultantOf, plural, renderMessage, type SlimAlert } from "./lib";
import { useJourneyRows } from "./use-journeys";

const STAGES: JourneyStage[] = ["onboarding", "rodando", "parado"];

function stageCount(stage: JourneyStage, count: number) {
  if (stage === "onboarding") return `${count} em onboarding`;
  if (stage === "rodando") return `${count} rodando`;
  return plural(count, "parado", "parados");
}

export function PlaybooksView({
  clients,
  alerts,
  extras,
  initialStore,
  now,
}: {
  clients: WorkspaceClient[];
  alerts: SlimAlert[];
  extras: Record<string, JourneyExtras>;
  initialStore: WorkspaceState;
  now: number;
}) {
  const signature = useMySignature();
  const { store } = usePrimedWorkspaceState(initialStore, now);
  const scope = useConsultantScope();
  const assignments = useAssignmentOverrides();
  useRememberView("playbooks");
  const rows = useJourneyRows(clients, alerts, extras, store, now);
  const matchesScope = scope.matches;
  const scoped = useMemo(
    () => rows.filter(({ client }) => matchesScope(consultantOf(client, assignments))),
    [rows, matchesScope, assignments],
  );
  const stats = useMemo(() => {
    const map = new Map<string, { total: number; byStage: Record<JourneyStage, number> }>();
    for (const { journey } of scoped) {
      for (const tag of journey.tags) {
        const entry = map.get(tag.key) ?? { total: 0, byStage: { onboarding: 0, rodando: 0, parado: 0 } };
        entry.total += 1;
        entry.byStage[journey.stage] += 1;
        map.set(tag.key, entry);
      }
    }
    return map;
  }, [scoped]);
  const ordered = PROBLEM_TAGS.map((tag, index) => ({ tag, index, stats: stats.get(tag.key) })).sort(
    (a, b) => (b.stats?.total ?? 0) - (a.stats?.total ?? 0) || a.index - b.index,
  );
  const filtered = scope.filtered;

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-5 lg:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Playbooks</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Os problemas que travam clientes, como resolver passo a passo e a mensagem pronta para mandar. As tags com{" "}
          <Sparkles className="inline size-3.5 text-amber-600 dark:text-amber-400" /> são detectadas sozinhas pelos
          dados; as outras o Fred ou você marcam no cliente.
          {filtered ? ` Contagens da carteira: ${scope.label}.` : ""}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {ordered.map(({ tag, stats: tagStats }) => {
          const template = tag.templateKey ? TEMPLATE_BY_KEY.get(tag.templateKey) : null;
          const total = tagStats?.total ?? 0;
          return (
            <article key={tag.key} id={tag.key} className="flex min-w-0 flex-col rounded-xl border bg-card">
              <div className="space-y-1.5 border-b px-4 py-3">
                <div className="flex items-start gap-2">
                  <h2 className="min-w-0 flex-1 text-base leading-snug font-semibold">{tag.label}</h2>
                  {tag.auto ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
                      <Sparkles className="size-3" /> automática
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">manual</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{tag.description}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs">
                  <span className={cn("font-medium tabular-nums", total === 0 && "text-muted-foreground")}>
                    {total === 0 ? "Nenhum cliente agora" : `${plural(total, "cliente", "clientes")} agora`}
                  </span>
                  {tagStats
                    ? STAGES.filter((stage) => tagStats.byStage[stage] > 0).map((stage) => (
                        <span key={stage} className="inline-flex items-center gap-1 text-muted-foreground">
                          <StageDot stage={stage} /> {stageCount(stage, tagStats.byStage[stage])}
                        </span>
                      ))
                    : null}
                  {total > 0 ? (
                    <Link
                      href={`/trafego/mesa?tag=${tag.key}`}
                      className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      Ver clientes <ArrowRight className="size-3.5" />
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3 px-4 py-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Como resolver</p>
                  <ol className="space-y-1.5">
                    {tag.playbook.map((step, index) => (
                      <li key={index} className="flex gap-2 text-sm leading-snug">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
                          {index + 1}
                        </span>
                        <span className="min-w-0">{step}</span>
                      </li>
                    ))}
                  </ol>
                  {tag.link ? (
                    <a
                      href={tag.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      {tag.link.label} <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    <MessageSquare className="size-3" /> Mensagem pronta{template ? ` · ${template.label}` : ""}
                  </p>
                  {template ? (
                    <p className="rounded-lg rounded-tl-none bg-emerald-50 px-3 py-2 text-[13px] leading-relaxed text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-50">
                      {renderMessage(template, SAMPLE_CLIENT, { consultantName: signature })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sem mensagem pronta — o ajuste é interno. Se precisar falar com o cliente, use o follow-up.
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Prévia com um cliente de exemplo ({SAMPLE_CLIENT.displayName}). No cliente real os dados vêm preenchidos.
      </p>
    </div>
  );
}
