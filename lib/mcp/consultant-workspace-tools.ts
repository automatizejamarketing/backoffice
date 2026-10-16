import "server-only";

import * as z from "zod/v4";
import { canAccessMarketingUser, type BackofficeActor } from "@/lib/auth/rbac-core";
import { ACCESS_LABEL, isCoreSegment } from "@/lib/consultant-workspace/access";
import { getWorkspaceClientDetail, getWorkspaceClients } from "@/lib/consultant-workspace/data";
import { computeJourney, MESSAGE_TEMPLATES, PROBLEM_TAGS, PROBLEM_TAG_BY_KEY, renderTemplate, STAGE_LABEL, TEMPLATE_BY_KEY } from "@/lib/consultant-workspace/journey";
import { getDossierAds, getJourneyExtras } from "@/lib/consultant-workspace/journey-data";
import { formatMoney, goalStatus, GOAL_KPI_LABEL, PLAN_LABEL } from "@/lib/consultant-workspace/metrics";
import { applyWorkspaceOp, readWorkspaceState } from "@/lib/consultant-workspace/state";
import { applyMetaChange, previewMetaChange, type MetaChange } from "@/lib/consultant-workspace/meta-actions";
import { getWhatsAppUrl } from "@/lib/phone";
import { ALERT_OUTCOME_LABEL, type AlertOutcome, type GoalKpi, type WorkspaceOp } from "@/lib/consultant-workspace/types";
import { isMatTemplateKey } from "@/lib/consultant-workspace/outreach-core";
import { batchConfirmationCode, verifyBatchConfirmation } from "./batch-confirmation";
import { CONSULTANT_OUTREACH_TOOLS } from "./consultant-outreach-tools";
import { defineTool, type McpTool } from "./tool";

/**
 * Ferramentas da área de Tráfego no MCP: o gestor opera várias contas pelo
 * Claude com as mesmas regras da tela.
 *
 * - Leitura: carteira por etapa da jornada, dossiê do cliente, catálogos.
 * - Escrita no banco: metas, notas, alertas (com resultado e nota), tags de
 *   problema, passagem de bastão — tudo com `source: "mcp"` na linha do tempo.
 * - Meta: lote com prévia ao vivo → código de confirmação → aplicar pelas
 *   mesmas rotas da tela de Marketing (nota obrigatória, auditoria).
 * - Mensagens: o MCP prepara o texto e o link do WhatsApp; nada é enviado
 *   sozinho. O envio é registrado quando o consultor confirma.
 */

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET ausente");
  return value;
}

const confirmationCode = (payload: unknown) => batchConfirmationCode(payload, secret());
const verifyCode = (code: string, payload: unknown) => verifyBatchConfirmation(code, payload, secret());

function assertClientAccess(actor: BackofficeActor, userId: string) {
  if (!canAccessMarketingUser(actor, userId)) throw new Error("Este cliente não está na sua carteira.");
}

async function loadJourneyFor(actor: BackofficeActor, userId: string, days = 7) {
  const [{ clients, alerts }, store] = await Promise.all([
    getWorkspaceClients(actor, { days, onlyUserId: userId }),
    readWorkspaceState({ userIds: [userId] }),
  ]);
  const client = clients[0];
  if (!client) throw new Error("Cliente não encontrado entre os clientes ativos.");
  const extras = await getJourneyExtras([userId]);
  const clientAlerts = alerts.filter((alert) => alert.userId === userId);
  const goal = store.goals[userId];
  const journey = computeJourney(client, extras[userId], store, clientAlerts, goalStatus(client.perf.kpi, goal).status);
  return { client, journey, store, goal, clientAlerts };
}

function money(value: number | null | undefined) {
  return value == null ? null : Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------- leitura

const journeyTools: McpTool[] = [
  defineTool({
    name: "list_clients_by_stage",
    title: "Clientes por etapa da jornada",
    permission: "marketing:read",
    write: false,
    description:
      "Carteira pela etapa do processo: onboarding (do trial até a 1ª campanha veicular, com o passo que trava), rodando (com motivos de atenção) e parado. " +
      "Inclui plano, tags de problema (marcadas pelo Fred ou detectadas), meta combinada e status vs meta, gasto e resultado do período, alertas abertos e dias na etapa. " +
      "Por padrão lista só os ativos (pagantes em dia, o mesmo número do \"Todos ativos\"); use `access` para ver trial, cancelados ainda com acesso, pagamento atrasado ou acesso manual. " +
      "Use para planejar o dia e para escolher em quais clientes agir em lote.",
    input: z.object({
      stage: z.enum(["onboarding", "rodando", "parado"]).optional(),
      tag: z.string().optional().describe("Chave de tag de problema (ver list_problem_tags)."),
      plan: z.enum(["premium", "pro", "starter", "sem_plano"]).optional(),
      access: z
        .enum(["ativos", "trial", "cancelado", "inadimplente", "manual", "todos"])
        .optional()
        .describe("Grupo de acesso. Padrão \"ativos\" (pagantes em dia). \"todos\" junta todos os grupos."),
      onlyNeedsAttention: z.boolean().optional().describe("Só quem precisa de ação humana."),
      days: z.number().int().min(1).max(30).optional().describe("Período em dias completos (até ontem). Padrão 7."),
      limit: z.number().int().min(1).max(100).optional().describe("Padrão 40."),
    }),
    async run(actor, input) {
      const days = input.days ?? 7;
      const [{ clients, alerts, range }, store] = await Promise.all([getWorkspaceClients(actor, { days }), readWorkspaceState()]);
      const access = input.access ?? "ativos";
      const accessCounts: Record<string, number> = {};
      for (const client of clients) {
        if (canAccessMarketingUser(actor, client.userId)) accessCounts[client.access] = (accessCounts[client.access] ?? 0) + 1;
      }
      const visible = clients.filter(
        (client) =>
          canAccessMarketingUser(actor, client.userId) &&
          (access === "todos" || (access === "ativos" ? isCoreSegment(client.access) : client.access === access)),
      );
      const extras = await getJourneyExtras(visible.map((client) => client.userId));
      const all = visible.map((client) => {
          const clientAlerts = alerts.filter((alert) => alert.userId === client.userId);
          const goal = store.goals[client.userId];
          const status = goalStatus(client.perf.kpi, goal);
          const journey = computeJourney(client, extras[client.userId], store, clientAlerts, status.status);
          return { client, journey, goal, status, alertCount: clientAlerts.length };
        });
      // Contagem da carteira inteira por etapa (antes dos filtros), para o panorama.
      const counts = { onboarding: 0, rodando: 0, parado: 0 };
      for (const row of all) counts[row.journey.stage] += 1;
      const rows = all
        .filter(({ client, journey }) =>
          (!input.stage || journey.stage === input.stage) &&
          (!input.plan || client.plan.tier === input.plan) &&
          (!input.tag || journey.tags.some((tag) => tag.key === input.tag)) &&
          (!input.onlyNeedsAttention || journey.needsAttention || (journey.stage !== "rodando" && client.plan.tier !== "starter")),
        )
        .sort((a, b) => {
          const rank = { premium: 0, pro: 1, starter: 2, sem_plano: 3 } as const;
          return rank[a.client.plan.tier] - rank[b.client.plan.tier] || b.client.perf.current.spend - a.client.perf.current.spend;
        });
      return {
        period: { from: range.from, to: range.to, comparedTo: { from: range.prevFrom, to: range.prevTo } },
        access,
        accessCounts,
        counts,
        total: rows.length,
        clients: rows.slice(0, input.limit ?? 40).map(({ client, journey, goal, status, alertCount }) => ({
          userId: client.userId,
          name: client.displayName,
          plan: PLAN_LABEL[client.plan.tier],
          access: ACCESS_LABEL[client.access],
          accessUntil: client.accessUntil,
          stage: STAGE_LABEL[journey.stage],
          daysInStage: journey.daysInStage,
          blocker: journey.blocker?.label ?? null,
          attention: journey.attentionReasons,
          tags: journey.tags.map((tag) => tag.key),
          handoffFromFred: Boolean(journey.handoff),
          billingRisk: journey.billingRisk,
          spend: money(client.perf.current.spend),
          spendPrevious: money(client.perf.previous.spend),
          result: { kind: client.perf.kpi.label, count: client.perf.kpi.count, cost: money(client.perf.kpi.cost), costLabel: client.perf.kpi.costLabel, roas: money(client.perf.kpi.roas) },
          goal: goal ? { kpi: GOAL_KPI_LABEL[goal.kpi], target: goal.target, monthlyBudget: goal.monthlyBudget, status: status.status } : null,
          openAlerts: alertCount,
          lastTouch: client.lastConsultantTouchAt,
        })),
      };
    },
  }),
  defineTool({
    name: "get_client_dossier",
    title: "Dossiê do cliente",
    permission: "marketing:read",
    write: false,
    description:
      "Tudo para decidir e agir em um cliente: etapa e passo que trava, tags de problema com playbook, passagem de bastão do Fred, meta e ritmo de verba, " +
      "campanhas do período vs anterior (com ids para ações), anúncios/criativos com maior gasto (ids, parcela do gasto, custo), alertas abertos agrupados (ids) e as últimas notas e ações.",
    input: z.object({ userId: z.string().uuid(), days: z.number().int().min(1).max(30).optional() }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      const days = input.days ?? 7;
      const [{ client, journey, store, goal, clientAlerts }, detail, ads] = await Promise.all([
        loadJourneyFor(actor, input.userId, days),
        getWorkspaceClientDetail(actor, input.userId, days),
        getDossierAds(input.userId, days),
      ]);
      const groups = new Map<string, { ruleTitle: string; ids: string[]; example: string; recommendation: string; entities: string[] }>();
      for (const alert of clientAlerts) {
        const group = groups.get(alert.ruleId) ?? { ruleTitle: alert.ruleTitle, ids: [], example: alert.evidence, recommendation: alert.recommendation, entities: [] };
        group.ids.push(alert.id);
        if (alert.entityName && group.entities.length < 5) group.entities.push(alert.entityName);
        groups.set(alert.ruleId, group);
      }
      return {
        client: { userId: client.userId, name: client.displayName, plan: PLAN_LABEL[client.plan.tier], phone: client.phone ? "tem telefone" : "sem telefone", meta: client.meta.health },
        journey: {
          stage: STAGE_LABEL[journey.stage],
          steps: journey.steps.map((step) => ({ step: step.label, done: step.done, optional: Boolean(step.optional) })),
          blocker: journey.blocker?.label ?? null,
          attention: journey.attentionReasons,
          handoffFromFred: journey.handoff,
          tags: journey.tags.map((tag) => ({ key: tag.key, label: tag.label, playbook: tag.playbook, suggestedTemplate: tag.templateKey })),
        },
        goal: goal ? { kpi: GOAL_KPI_LABEL[goal.kpi], target: goal.target, monthlyBudget: goal.monthlyBudget, monthToDateSpend: money(client.perf.monthToDateSpend) } : null,
        performance: {
          current: { spend: money(client.perf.current.spend), ...client.perf.kpi, cost: money(client.perf.kpi.cost), roas: money(client.perf.kpi.roas) },
          previous: { spend: money(client.perf.previous.spend), ...client.perf.previousKpi, cost: money(client.perf.previousKpi.cost), roas: money(client.perf.previousKpi.roas) },
        },
        campaigns: (detail?.campaigns ?? []).slice(0, 15).map((campaign) => ({
          campaignId: campaign.campaignId,
          name: campaign.name,
          status: campaign.status,
          objective: campaign.objective,
          dailyBudget: campaign.dailyBudget,
          spend: money(campaign.current.spend),
          spendPrevious: money(campaign.previous.spend),
          result: campaign.kpi.count,
          resultKind: campaign.kpi.label,
          cost: money(campaign.kpi.cost),
          costPrevious: money(campaign.previousKpi.cost),
        })),
        ads: ads.slice(0, 12).map((ad) => ({
          adId: ad.adId,
          name: ad.name,
          campaign: ad.campaignName,
          format: ad.isVideo ? "vídeo" : "imagem",
          status: ad.status,
          spendShare: Math.round(ad.spendShare * 100) / 100,
          spend: money(ad.current.spend),
          result: ad.kpi.count,
          cost: money(ad.kpi.cost),
          costPrevious: money(ad.previousKpi.cost),
        })),
        openAlertGroups: [...groups.values()],
        recentHistory: [
          ...store.notes.filter((note) => note.userId === input.userId).slice(0, 8).map((note) => ({ at: note.createdAt, kind: note.kind, text: note.text, by: note.author })),
          ...(detail?.changes ?? []).filter((change) => change.source === "backoffice_admin").slice(0, 8).map((change) => ({ at: change.occurredAt, kind: `mudança: ${change.changeKind}`, text: `${change.entityName ?? ""} ${change.note ?? ""}`.trim(), by: change.actor ?? "" })),
        ].sort((a, b) => (a.at < b.at ? 1 : -1)),
        aiAnalysis: store.aiAnalyses[input.userId]?.text ?? null,
      };
    },
  }),
  defineTool({
    name: "list_problem_tags",
    title: "Tags de problema e playbooks",
    permission: "marketing:read",
    write: false,
    description: "Catálogo de tags de problema (ex.: erro de não discriminação da Meta) com o playbook de resolução e a mensagem sugerida.",
    input: z.object({}),
    async run() {
      return { tags: PROBLEM_TAGS.map((tag) => ({ key: tag.key, label: tag.label, description: tag.description, playbook: tag.playbook, suggestedTemplate: tag.templateKey, autoDetected: Boolean(tag.auto) })) };
    },
  }),
  defineTool({
    name: "list_message_templates",
    title: "Mensagens prontas",
    permission: "marketing:read",
    write: false,
    description: "Mensagens prontas para o cliente (WhatsApp), com as etapas em que se aplicam e o texto com variáveis.",
    input: z.object({}),
    async run() {
      return { templates: MESSAGE_TEMPLATES.map((template) => ({ key: template.key, label: template.label, stages: template.stages, body: template.body })) };
    },
  }),
];

// ---------------------------------------------------------------- escrita local (sem Meta)

const OUTCOMES = Object.keys(ALERT_OUTCOME_LABEL) as [AlertOutcome, ...AlertOutcome[]];
const GOAL_KPIS = ["cpa", "cpl", "custo_conversa", "roas", "custo_resultado"] as const satisfies readonly GoalKpi[];

const localWriteTools: McpTool[] = [
  defineTool({
    name: "set_client_goal",
    title: "Definir meta do cliente",
    permission: "marketing:write",
    write: true,
    description: "Registra a meta combinada com o cliente: indicador (CPA, CPL, custo por conversa, custo por resultado ou ROAS mínimo), alvo e verba mensal.",
    input: z.object({
      userId: z.string().uuid(),
      kpi: z.enum(GOAL_KPIS),
      target: z.number().positive().describe("Custo máximo em R$ ou ROAS mínimo (ex.: 3)."),
      monthlyBudget: z.number().positive().optional().describe("Verba mensal combinada, em R$."),
    }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      await applyWorkspaceOp(actor, { op: "setGoal", userId: input.userId, goal: { kpi: input.kpi, target: input.target, monthlyBudget: input.monthlyBudget ?? null } } as WorkspaceOp, "mcp");
      return { ok: true, saved: `${GOAL_KPI_LABEL[input.kpi]} ${input.kpi === "roas" ? `${input.target}x` : formatMoney(input.target)}` };
    },
  }),
  defineTool({
    name: "add_client_note",
    title: "Registrar nota ou contato",
    permission: "marketing:write",
    write: true,
    description: "Registra no histórico do cliente uma nota, um contato com o cliente ou uma reunião. Use depois de agir, para o próximo gestor saber o que aconteceu.",
    input: z.object({ userId: z.string().uuid(), kind: z.enum(["nota", "contato", "reuniao", "acao"]).default("nota"), text: z.string().min(3).max(2000) }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      await applyWorkspaceOp(actor, { op: "addNote", userId: input.userId, kind: input.kind, text: input.text } as WorkspaceOp, "mcp");
      return { ok: true };
    },
  }),
  defineTool({
    name: "resolve_alerts",
    title: "Concluir alertas",
    permission: "marketing:write",
    write: true,
    description:
      "Conclui alertas de um cliente dizendo o que foi feito (obrigatório) e uma nota curta que vai para o histórico. " +
      "Use falso_alarme para dispensar. Só conclua o que foi de fato tratado — não use para limpar a fila.",
    input: z.object({
      userId: z.string().uuid(),
      insightIds: z.array(z.string().uuid()).min(1).max(50),
      outcome: z.enum(OUTCOMES),
      note: z.string().min(5).max(1000).describe("O que foi feito ou combinado, em uma frase."),
    }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      await applyWorkspaceOp(actor, { op: "alertAction", insightIds: input.insightIds, userId: input.userId, status: input.outcome === "falso_alarme" ? "dismissed" : "done", outcome: input.outcome, note: input.note } as WorkspaceOp, "mcp");
      return { ok: true, resolved: input.insightIds.length, outcome: ALERT_OUTCOME_LABEL[input.outcome] };
    },
  }),
  defineTool({
    name: "snooze_alerts",
    title: "Adiar alertas",
    permission: "marketing:write",
    write: true,
    description: "Tira alertas da fila por N dias (voltam às 8h do dia). Use quando depende do cliente ou de esperar dados.",
    input: z.object({ userId: z.string().uuid(), insightIds: z.array(z.string().uuid()).min(1).max(50), days: z.number().int().min(1).max(14), reason: z.string().max(500).optional() }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      const until = new Date();
      until.setDate(until.getDate() + input.days);
      until.setHours(8, 0, 0, 0);
      await applyWorkspaceOp(actor, { op: "alertAction", insightIds: input.insightIds, userId: input.userId, status: "snoozed", snoozeUntil: until.toISOString(), note: input.reason ?? null } as WorkspaceOp, "mcp");
      return { ok: true, snoozedUntil: until.toISOString() };
    },
  }),
  defineTool({
    name: "set_client_problem_tags",
    title: "Marcar tags de problema",
    permission: "marketing:write",
    write: true,
    description: "Define as tags de problema marcadas à mão para o cliente (substitui a lista). Chaves em list_problem_tags.",
    input: z.object({ userId: z.string().uuid(), tags: z.array(z.string()).max(10) }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      const unknown = input.tags.filter((tag) => !PROBLEM_TAG_BY_KEY.has(tag));
      if (unknown.length) throw new Error(`Tags desconhecidas: ${unknown.join(", ")}`);
      await applyWorkspaceOp(actor, { op: "setClientTags", userId: input.userId, tags: input.tags } as WorkspaceOp, "mcp");
      return { ok: true, tags: input.tags };
    },
  }),
  defineTool({
    name: "record_onboarding_handoff",
    title: "Registrar passagem de bastão",
    permission: "marketing:write",
    write: true,
    description: "Registra a passagem de bastão do onboarding (Fred) para o gestor: resumo da call, próximos passos, data e tags de problema.",
    input: z.object({
      userId: z.string().uuid(),
      summary: z.string().min(5).max(2000),
      nextSteps: z.string().max(2000).default(""),
      callDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      tags: z.array(z.string()).max(10).default([]),
    }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      await applyWorkspaceOp(actor, { op: "setHandoff", userId: input.userId, summary: input.summary, nextSteps: input.nextSteps, callDate: input.callDate ?? null, tags: input.tags } as WorkspaceOp, "mcp");
      return { ok: true };
    },
  }),
];

// ---------------------------------------------------------------- Meta: prévia ao vivo + confirmação

const MAX_BATCH = 20;

const changeSchema = z.object({
  userId: z.string().uuid(),
  entityId: z.string().min(3).describe("Id da campanha, conjunto ou anúncio (de get_client_dossier ou get_client_campaigns)."),
  action: z.enum(["pause", "activate", "set_daily_budget", "duplicate"]),
  value: z.number().positive().optional().describe("set_daily_budget: novo orçamento diário em R$."),
  note: z.string().min(5).max(500).describe("Motivo, em uma frase. Vai para a auditoria e o histórico."),
  resolvesInsightIds: z.array(z.string().uuid()).max(20).optional().describe("Alertas que esta mudança trata (concluídos se a mudança der certo)."),
});
type Change = z.infer<typeof changeSchema>;

function normalize(changes: Change[]) {
  return changes.map((change) => [change.userId, change.entityId, change.action, change.value ?? null, change.note, [...(change.resolvesInsightIds ?? [])].sort()]);
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const OUTCOME_FOR_ACTION: Record<Change["action"], AlertOutcome> = {
  pause: "pausei",
  activate: "ajustei_campanha",
  set_daily_budget: "escalei_verba",
  duplicate: "ajustei_campanha",
};

const metaTools: McpTool[] = [
  defineTool({
    name: "preview_meta_changes",
    title: "Prévia de mudanças na Meta (lote)",
    permission: "marketing:write",
    write: false,
    description:
      `Monta a prévia de um LOTE (até ${MAX_BATCH}) de mudanças em campanhas, conjuntos ou anúncios de um ou vários clientes: pausar, ativar, orçamento diário ou duplicar (a cópia nasce pausada). ` +
      "Lê o estado ATUAL na Meta, mostra atual → novo, avisos (aumento acima de 50%, corte grande) e bloqueios (orçamento no outro nível, Facebook desconectado). " +
      "Devolve um confirmationCode válido por 15 min quando nada bloqueia. MOSTRE a prévia ao usuário e só chame apply_meta_changes depois da aprovação explícita, com as mesmas mudanças.",
    input: z.object({ changes: z.array(changeSchema).min(1).max(MAX_BATCH) }),
    async run(actor, input) {
      for (const change of input.changes) assertClientAccess(actor, change.userId);
      const items = await inBatches(input.changes, 4, (change) => previewMetaChange(actor, change as MetaChange));
      const blocking = items.filter((item) => item.blocking.length > 0).length;
      return {
        items: items.map((item, index) => ({
          userId: item.userId,
          entity: item.entity,
          action: item.action,
          from: item.from,
          to: item.to,
          note: input.changes[index].note,
          resolvesAlerts: input.changes[index].resolvesInsightIds?.length ?? 0,
          warnings: item.warnings,
          blocking: item.blocking,
        })),
        ...(blocking
          ? { confirmationCode: null, blockingItems: blocking, hint: "Corrija ou remova os itens bloqueados e gere outra prévia." }
          : { confirmationCode: confirmationCode(normalize(input.changes)) }),
      };
    },
  }),
  defineTool({
    name: "apply_meta_changes",
    title: "Aplicar mudanças na Meta (lote)",
    permission: "marketing:write",
    write: true,
    destructive: true,
    description:
      "Aplica na Meta o lote aprovado em preview_meta_changes. Exige o confirmationCode da prévia e EXATAMENTE as mesmas mudanças; só chame depois que o usuário aprovar. " +
      "Cada item relê o estado ao vivo e passa pelas mesmas rotas da tela (nota obrigatória, auditoria); um item que falhar não impede os outros.",
    input: z.object({ changes: z.array(changeSchema).min(1).max(MAX_BATCH), confirmationCode: z.string() }),
    async run(actor, input) {
      for (const change of input.changes) assertClientAccess(actor, change.userId);
      const verdict = verifyCode(input.confirmationCode, normalize(input.changes));
      if (verdict === "expired") throw new Error("A prévia expirou (15 min). Gere outra com preview_meta_changes e mostre ao usuário.");
      if (verdict === "mismatch") throw new Error("O lote mudou desde a prévia aprovada. Gere outra prévia e peça aprovação de novo.");
      const results = [];
      // Em sequência: cada mudança escreve na Meta e na auditoria; nada de rajada na conta do cliente.
      for (const change of input.changes) {
        try {
          const applied = await applyMetaChange(actor, change as MetaChange, "mcp");
          if (change.resolvesInsightIds?.length) {
            await applyWorkspaceOp(
              actor,
              { op: "alertAction", insightIds: change.resolvesInsightIds, userId: change.userId, status: "done", outcome: OUTCOME_FOR_ACTION[change.action], note: change.note },
              "mcp",
            );
          }
          results.push({ userId: change.userId, entity: applied.entity, action: change.action, status: "aplicado", summary: applied.summary });
        } catch (error) {
          results.push({ userId: change.userId, entityId: change.entityId, action: change.action, status: "falhou", error: error instanceof Error ? error.message : String(error) });
        }
      }
      return {
        applied: results.filter((result) => result.status === "aplicado").length,
        failed: results.filter((result) => result.status === "falhou").length,
        results,
      };
    },
  }),
];

// ---------------------------------------------------------------- mensagens ao cliente

const messageTools: McpTool[] = [
  defineTool({
    name: "prepare_client_messages",
    title: "Preparar mensagens ao cliente",
    permission: "marketing:read",
    write: false,
    description:
      "Prepara mensagens de WhatsApp para um ou vários clientes a partir de um template (list_message_templates), preenchidas com os dados de cada um; " +
      "você pode passar o texto final já ajustado. Devolve o texto e o link do WhatsApp do cliente — o consultor envia do próprio WhatsApp; nada é enviado sozinho. " +
      "Depois que ele confirmar o envio, registre com record_client_messages_sent.",
    input: z.object({
      messages: z
        .array(z.object({ userId: z.string().uuid(), templateKey: z.string(), text: z.string().max(1500).optional(), nextStep: z.string().max(300).optional() }))
        .min(1)
        .max(30),
    }),
    async run(actor, input) {
      for (const message of input.messages) assertClientAccess(actor, message.userId);
      const { clients } = await getWorkspaceClients(actor, { days: 7 });
      const byId = new Map(clients.map((client) => [client.userId, client]));
      return {
        messages: input.messages.map((message) => {
          const client = byId.get(message.userId);
          const template = TEMPLATE_BY_KEY.get(message.templateKey);
          if (!client) throw new Error(`Cliente ${message.userId} não está entre os ativos da sua carteira.`);
          if (!template) throw new Error(`Template desconhecido: ${message.templateKey}`);
          const text = message.text ?? renderTemplate(template, client, { consultantName: actor.name ?? null, nextStep: message.nextStep ?? null });
          const warnings: string[] = [];
          const link = getWhatsAppUrl(client.phone, text);
          if (!link) warnings.push("Cliente sem telefone válido cadastrado.");
          if (/\[[a-z_ ]+\]/i.test(text)) warnings.push("Ainda há [campos] para preencher no texto.");
          return { userId: client.userId, client: client.displayName, templateKey: message.templateKey, text, whatsappLink: link, warnings };
        }),
      };
    },
  }),
  defineTool({
    name: "record_client_messages_sent",
    title: "Registrar mensagens enviadas",
    permission: "marketing:write",
    write: true,
    description: "Registra no histórico de cada cliente as mensagens que o consultor confirmou ter enviado (texto final).",
    input: z.object({
      messages: z.array(z.object({ userId: z.string().uuid(), templateKey: z.string(), text: z.string().min(1).max(1500) })).min(1).max(30),
    }),
    async run(actor, input) {
      for (const message of input.messages) assertClientAccess(actor, message.userId);
      if (input.messages.some((message) => isMatTemplateKey(message.templateKey))) {
        throw new Error("Mensagens da Mat são registradas sozinhas por send_mat_messages.");
      }
      for (const message of input.messages) {
        await applyWorkspaceOp(actor, { op: "sendMessage", userId: message.userId, templateKey: message.templateKey, text: message.text }, "mcp");
      }
      return { recorded: input.messages.length };
    },
  }),
];

export const CONSULTANT_WORKSPACE_TOOLS: McpTool[] = [
  ...journeyTools,
  ...localWriteTools,
  ...metaTools,
  ...messageTools,
  ...CONSULTANT_OUTREACH_TOOLS,
];
