"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, MessageSquare, Phone, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeJourney, type JourneyExtras } from "@/lib/consultant-workspace/journey";
import { PLAN_SERVICE, formatMoney, formatRelative, goalStatus } from "@/lib/consultant-workspace/metrics";
import type {
  WorkspaceClient,
  WorkspaceClientDetail,
  WorkspaceRange,
  WorkspaceState,
} from "@/lib/consultant-workspace/types";
import { MetaHealthBadge, PlanBadge } from "@/components/consultant-workspace/shared/primitives";
import { ClientTimeline } from "@/components/consultant-workspace/shared/client-timeline";
import { SuggestedActionsSection } from "@/components/consultant-workspace/shared/suggested-actions";
import { AssignConsultant, useAssignedConsultant } from "@/components/consultant-workspace/common/assignment";
import { FinanceChip, JourneyStepper, StagePill } from "@/components/consultant-workspace/common/journey-bits";
import { useLastView } from "@/components/consultant-workspace/common/last-view";
import { daysInStageText } from "@/components/consultant-workspace/common/model";
import { usePrimedWorkspaceState } from "@/components/consultant-workspace/common/use-primed-state";
import { useMySignature } from "@/components/consultant-workspace/common/workspace-context";
import {
  clientSentenceFrom,
  formatPhone,
  isAlertLive,
  primaryTemplateKey,
  toIso,
} from "@/components/consultant-workspace/jornada/lib";
import type { StoppedSpend } from "@/components/consultant-workspace/jornada/server-data";
import { TemplateComposerDialog, type ComposerTarget } from "./composer";
import {
  AiAnalysisCard,
  AlertsSummary,
  CampaignReport,
  CreativesSection,
  KpiStrip,
  MiniReport,
  PeriodTabs,
  Section,
} from "./dossier";
import { BlockerChecklist, HandoffCard } from "./handoff";
import { ProblemTagsPanel } from "./tags-panel";

/**
 * Página do cliente: jornada, problemas e playbooks, dossiê (números, análise
 * da IA, campanhas, criativos, alertas, resumo para o cliente) e histórico.
 * As três visões (Fila, Mesa, Jornada) abrem aqui.
 */
export function ClientJourneyView({
  detail,
  stageClient,
  extras,
  stopped,
  range,
  initialStore,
  now,
}: {
  detail: WorkspaceClientDetail;
  /** Cliente medido em 7 dias: a etapa não muda quando o período da tela muda. */
  stageClient: WorkspaceClient;
  extras: JourneyExtras | null;
  stopped: StoppedSpend | null;
  range: WorkspaceRange;
  initialStore: WorkspaceState;
  now: number;
}) {
  const { client } = detail;
  const signature = useMySignature();
  const { store } = usePrimedWorkspaceState(initialStore, now);
  const back = useLastView();
  const assigned = useAssignedConsultant(client.userId, { id: client.consultant.key, name: client.consultant.name });
  const [composer, setComposer] = useState<ComposerTarget | null>(null);

  const liveAlerts = useMemo(
    () => detail.alerts.filter((alert) => isAlertLive(alert, store, now)),
    [detail.alerts, store, now],
  );
  const journey = useMemo(
    () =>
      computeJourney(
        stageClient,
        extras ?? undefined,
        store,
        liveAlerts,
        goalStatus(stageClient.perf.kpi, store.goals[client.userId]).status,
        now,
      ),
    [stageClient, extras, store, liveAlerts, client.userId, now],
  );

  // Quem escreve a mensagem assina ("Aqui é o …").
  const consultantName = signature;
  const analysis = store.aiAnalyses[client.userId];
  const aiSentence = clientSentenceFrom(analysis?.text);

  const openComposer = (templateKey?: string | null, nextStep?: string | null) =>
    setComposer({ client, journey, templateKey: templateKey ?? primaryTemplateKey(journey, client), nextStep });

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 px-4 py-4 lg:px-6">
      <Link href={back.href} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {back.label}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{client.displayName}</h1>
            <PlanBadge tier={client.plan.tier} className="text-xs" />
            <StagePill stage={journey.stage} size="md" />
            {journey.billingRisk ? <FinanceChip text={journey.billingRisk} /> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground">Prometido no plano:</span> {PLAN_SERVICE[client.plan.tier]}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {client.name && client.name !== client.displayName ? <span>{client.name}</span> : null}
            {client.phone ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Phone className="size-3" /> {formatPhone(client.phone)}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">sem telefone cadastrado</span>
            )}
            <span>{client.email}</span>
          </p>
          <MetaHealthLine client={client} />
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Responsável</span>
            <AssignConsultant userId={client.userId} clientName={client.displayName} current={assigned} />
          </div>
          <Button size="sm" onClick={() => openComposer()}>
            <MessageSquare className="size-3.5" /> Mensagem
          </Button>
          <Link
            href={`/users/${client.userId}?tab=marketing`}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Cadastro e Marketing do cliente <ExternalLink className="size-3" />
          </Link>
        </div>
      </header>

      <JourneyStepper journey={journey} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <SuggestedActionsSection
            userId={client.userId}
            clientName={client.displayName}
            clientFullName={client.name}
            days={range.days}
          />
          <ProblemTagsPanel userId={client.userId} journey={journey} store={store} onMessage={(key) => openComposer(key)} />

          {journey.stage === "onboarding" ? (
            <>
              <HandoffCard client={client} journey={journey} />
              <BlockerChecklist client={client} journey={journey} onMessage={(key) => openComposer(key)} />
              {liveAlerts.length > 0 ? <AlertsSummary userId={client.userId} alerts={detail.alerts} now={now} /> : null}
            </>
          ) : (
            <>
              {journey.stage === "parado" ? (
                <StoppedBanner
                  days={journey.daysInStage}
                  stopped={stopped}
                  onMessage={() => openComposer("campanha_parada")}
                />
              ) : null}
              <Section
                title="Dossiê"
                subtitle={`O que aconteceu, o que fazer e o que mandar · ${daysInStageText(journey) ?? STAGE_FALLBACK}`}
                right={<PeriodTabs days={range.days} />}
              >
                <KpiStrip client={client} range={range} store={store} />
              </Section>
              <AiAnalysisCard
                userId={client.userId}
                days={range.days}
                analysis={analysis}
                onUseSentence={(sentence) => openComposer("resumo_semanal", sentence)}
              />
              <CampaignReport detail={detail} range={range} />
              <CreativesSection userId={client.userId} days={range.days} />
              <AlertsSummary userId={client.userId} alerts={detail.alerts} now={now} />
              <MiniReport
                client={client}
                aiSentence={aiSentence}
                consultantName={consultantName}
                onCompose={() => openComposer("resumo_semanal", aiSentence)}
              />
            </>
          )}
        </div>

        <aside className="min-w-0 space-y-2 xl:sticky xl:top-4 xl:max-h-[calc(100svh-9rem)] xl:self-start xl:overflow-y-auto">
          <h2 className="text-base font-semibold">Histórico</h2>
          <ClientTimeline detail={detail} />
        </aside>
      </div>

      <TemplateComposerDialog target={composer} onClose={() => setComposer(null)} />
    </div>
  );
}

const STAGE_FALLBACK = "etapa atual";

function StoppedBanner({
  days,
  stopped,
  onMessage,
}: {
  days: number | null;
  stopped: StoppedSpend | null;
  onMessage: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60">
      <TrendingDown className="size-4 shrink-0 text-zinc-600 dark:text-zinc-400" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          Parou de veicular{days != null ? (days <= 1 ? " ontem" : ` há ${days} dias`) : ""}
          {stopped && stopped.weekSpend > 0 ? (
            <span className="font-normal text-muted-foreground"> · rodava {formatMoney(stopped.weekSpend, false)}/semana</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Primeiro descubra por quê: saldo ou cartão na Meta, campanha pausada pelo cliente, conta restrita ou
          verba que acabou.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onMessage}>
        <MessageSquare className="size-3.5" /> Perguntar ao cliente
      </Button>
    </div>
  );
}

function MetaHealthLine({ client }: { client: WorkspaceClient }) {
  const { meta } = client;
  const account = meta.accountName ? `“${meta.accountName}”` : "de anúncios";
  const text: Record<typeof meta.health, string> = {
    ok: `Conta ${account} conectada${meta.checkedAt ? ` · lida ${formatRelative(toIso(meta.checkedAt))}` : ""}`,
    token_invalido: "A conexão com a Meta caiu. O cliente precisa reconectar — até lá nada é acompanhado nem publicado.",
    erro_checagem: "Conectada, mas a última leitura da conta falhou. Os números podem estar atrasados.",
    checagem_velha: "Conectada, mas a conta não é lida há mais de 2 dias. Os números podem estar atrasados.",
    sem_meta: "Ainda não conectou o Facebook de anúncios.",
  };
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs")}>
      <MetaHealthBadge health={meta.health} />
      <span className="text-muted-foreground" suppressHydrationWarning>
        {text[meta.health]}
      </span>
      {client.publishHolds > 0 ? (
        <span className="text-amber-700 dark:text-amber-400">
          · {client.publishHolds === 1 ? "1 publicação retida" : `${client.publishHolds} publicações retidas`}
        </span>
      ) : null}
    </p>
  );
}
