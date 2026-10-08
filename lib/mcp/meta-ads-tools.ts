import "server-only";

import * as z from "zod/v4";
import { canAccessMarketingUser, type BackofficeActor } from "@/lib/auth/rbac-core";
import { playbookAlertRuleTitle } from "@/lib/backoffice/playbook-alert-dashboard";
import { PORTFOLIO_SUBSCRIPTION_STATUS_FILTER_VALUES } from "@/lib/backoffice/portfolio-filters";
import { getBusinessPortfolioPage } from "@/lib/db/business-queries";
import { playbookBusinessDateKey, shiftYmd } from "@/lib/playbook-insights/dates";
import { getClientCampaigns } from "./meta-ads-live";
import { clip, compareWindows, DEFAULT_CURRENCY, PORTFOLIO_SORTS, resolvePeriods, rollUpByCurrency, sortComparisons, totalsByCurrency } from "./meta-ads-metrics";
import {
  ALERT_FAMILIES, listPendingAlerts, loadAccountCurrencies, loadAdAccountsByUser, loadClientLabels, loadCollectionIssues, loadPortfolioWindows, loadSpendByAccount,
  loadScopedMetaClientIds, loadSpendByUser, resolveConsultantScope, type AlertFamily,
} from "./meta-ads-queries";
import { defineTool, type McpTool } from "./tool";

/** Calendar day in Brasília, like every date the consultant sees in the backoffice. */
const ymd = (d: Date | string | null | undefined) => (d ? playbookBusinessDateKey(new Date(d)) : null);

const periodInput = {
  days: z.number().int().min(1).max(90).optional().describe("Últimos N dias completos (até ontem). Padrão 7."),
  since: z.string().optional().describe("Início AAAA-MM-DD (use com until em vez de days)."),
  until: z.string().optional().describe("Fim AAAA-MM-DD, inclusive."),
};
const consultantEmail = z.string().email().optional().describe("Só admin: restringe à carteira deste consultor.");

function assertClientAccess(actor: BackofficeActor, userId: string) {
  if (!canAccessMarketingUser(actor, userId)) throw new Error("Este cliente não está na sua carteira.");
}

export const META_ADS_TOOLS: McpTool[] = [
  defineTool({
    name: "list_my_clients", title: "Listar clientes da carteira", permission: "marketing:read", write: false,
    description:
      "Clientes que você acompanha (consultor: os atribuídos; admin: todos, paginado). Para cada um: saúde do negócio e motivos, assinatura, " +
      "contas de anúncio, gasto dos últimos 7 dias por moeda (ex.: {\"BRL\": 1234.5}), campanhas gerenciadas ([AM]) no ar e alertas abertos. Não consulta a Meta: use portfolio_performance para desempenho.",
    input: z.object({
      search: z.string().optional().describe("Nome, e-mail ou empresa."),
      subscriptionStatus: z.enum(PORTFOLIO_SUBSCRIPTION_STATUS_FILTER_VALUES).default("all"),
      managedCampaigns: z.enum(["all", "active", "inactive"]).default("all").describe("active = com campanha [AM] no ar."),
      consultantEmail,
      page: z.number().int().min(1).default(1),
      pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(50),
    }),
    async run(actor, input) {
      const consultantId = await resolveConsultantScope(actor, input.consultantEmail);
      const result = await getBusinessPortfolioPage(actor, {
        consultantId: consultantId ?? "all", subscriptionStatus: input.subscriptionStatus, campaignStatus: input.managedCampaigns,
        search: input.search ?? "", page: input.page, pageSize: input.pageSize,
      });
      const ids = result.items.map(i => i.userId);
      const last7 = resolvePeriods({ days: 7 }).current;
      const [spend, accounts] = await Promise.all([loadSpendByUser(ids, last7), loadAdAccountsByUser(ids)]);
      return {
        total: result.total, page: result.page, pageSize: result.pageSize,
        clients: result.items.map(i => ({
          userId: i.userId,
          client: i.companyName?.trim() || i.userEmail,
          email: i.userEmail,
          consultant: i.consultantName ?? i.consultantEmail,
          subscription: i.subscriptionStatus, accessUntil: ymd(i.expirationDate),
          health: { status: i.health.status, reasons: i.health.reasons.map(r => r.label), nextAction: i.health.nextAction },
          metaConnected: i.metaAccountName != null,
          adAccounts: accounts.get(i.userId) ?? [],
          spendLast7Days: spend.get(i.userId) ?? {},
          activeManagedCampaigns: i.managedCampaignNames,
          ...(i.managedCampaignError ? { metaError: clip(i.managedCampaignError, 160) } : {}),
          openAlerts: i.playbookInsights.openCount, worstAlert: i.playbookInsights.highestSeverity,
        })),
      };
    },
  }),
  defineTool({
    name: "portfolio_performance", title: "Desempenho da carteira", permission: "marketing:read", write: false,
    description:
      "Meta Ads de todos os clientes da carteira de uma vez: período vs período anterior de mesmo tamanho (padrão: últimos 7 dias completos vs os 7 anteriores). " +
      "Por cliente: gasto, resultados (o resultado de cada campanha, como a Meta define), custo por resultado, compras, receita, ROAS, leads, conversas, CTR de link e variação %. " +
      "Lê o histórico diário coletado toda madrugada (dados até ontem; hoje fica incompleto), então é rápido e não gasta cota da Meta. " +
      "Clientes sem gasto nos dois períodos vêm só em idleClients. Valores na moeda da conta (quase sempre BRL); moedas nunca são somadas: totais vêm por moeda e um cliente com contas em duas moedas aparece em duas linhas.",
    input: z.object({
      ...periodInput,
      sortBy: z.enum(PORTFOLIO_SORTS).default("spend"),
      order: z.enum(["desc", "asc"]).default("desc").describe("desc com *_change = maiores altas primeiro; asc = maiores quedas."),
      minSpend: z.number().min(0).default(0).describe("Só clientes que gastaram pelo menos isto no período."),
      userIds: z.array(z.string().uuid()).max(200).optional().describe("Restringe a estes clientes."),
      consultantEmail,
      limit: z.number().int().min(1).max(200).default(50),
    }),
    async run(actor, input) {
      const periods = resolvePeriods(input);
      const consultantId = await resolveConsultantScope(actor, input.consultantEmail);
      const [windows, metaClientIds] = await Promise.all([
        loadPortfolioWindows({ consultantId, current: periods.current, previous: periods.previous, userIds: input.userIds }),
        loadScopedMetaClientIds(consultantId, input.userIds),
      ]);
      const currencies = await loadAccountCurrencies([...new Set(windows.map(w => w.accountId))]);
      const spending = rollUpByCurrency(windows, accountId => currencies.get(accountId))
        .filter(w => w.current.spend > 0 || w.previous.spend > 0);
      const spendingIds = new Set(spending.map(w => w.userId));
      const idleIds = metaClientIds.filter(id => !spendingIds.has(id));
      const shown = sortComparisons(
        spending.filter(w => w.current.spend >= input.minSpend).map(w => ({ ...w, metrics: compareWindows(w.current, w.previous) })),
        input.sortBy, input.order,
      ).slice(0, input.limit);
      const labelIds = [...new Set([...shown.map(w => w.userId), ...idleIds.slice(0, 100)])];
      const [labels, issues] = await Promise.all([loadClientLabels(labelIds), loadCollectionIssues(labelIds, shiftYmd(periods.current.until, -7))]);
      const totals = totalsByCurrency(spending);
      return {
        period: { ...periods.current, previous: periods.previous, days: periods.days },
        notes: [
          ...(periods.includesToday ? ["O período inclui hoje: o dia de hoje ainda está incompleto no histórico."] : []),
          ...(totals.length > 1 ? ["Há contas em mais de uma moeda: totais e linhas são separados por moeda (campo currency), sem conversão."] : []),
        ],
        totals,
        clients: shown.map(w => {
          const label = labels.get(w.userId);
          const issue = issues.get(w.userId);
          return {
            userId: w.userId, client: label?.client ?? w.userId, consultant: label?.consultant ?? null, accountCount: w.accounts,
            ...(w.currency !== DEFAULT_CURRENCY ? { currency: w.currency } : {}),
            ...(issue ? { dataIssue: issue } : {}),
            ...w.metrics,
          };
        }),
        hiddenRows: Math.max(0, spending.length - shown.length),
        idleClients: {
          count: idleIds.length,
          sample: idleIds.slice(0, 100).map(id => ({ userId: id, client: labels.get(id)?.client ?? id, ...(issues.get(id) ? { dataIssue: issues.get(id) } : {}) })),
        },
      };
    },
  }),
  defineTool({
    name: "get_client_campaigns", title: "Campanhas de um cliente", permission: "marketing:read", write: false,
    description:
      "Detalhe ao vivo na Meta de um cliente: campanhas (padrão), conjuntos ou anúncios com gasto, resultado e custo por resultado (pelo objetivo de cada campanha), " +
      "receita, ROAS, CTR, CPC, CPM, frequência e variação contra o período anterior. No nível de campanha também traz as campanhas ativas sem gasto, com orçamento. " +
      "Lê as contas de anúncio do cliente com mais gasto recente (até 5, as mesmas que a carteira soma); adAccountId lê uma conta específica. Período padrão: últimos 7 dias completos; until pode ser hoje. Só leitura.",
    input: z.object({
      userId: z.string().uuid().describe("Cliente (list_my_clients ou portfolio_performance)."),
      level: z.enum(["campaign", "adset", "ad"]).default("campaign"),
      campaignId: z.string().regex(/^\d+$/).optional().describe("Só esta campanha (e, nos níveis adset/ad, seus conjuntos ou anúncios)."),
      adAccountId: z.string().regex(/^(act_)?\d+$/).optional().describe("Uma conta específica do cliente."),
      ...periodInput,
      limit: z.number().int().min(1).max(100).default(30),
    }),
    async run(actor, input) {
      assertClientAccess(actor, input.userId);
      const periods = resolvePeriods(input);
      const [labels, spendByAccount] = await Promise.all([
        loadClientLabels([input.userId]),
        loadSpendByAccount(input.userId, { since: shiftYmd(periods.current.until, -29), until: periods.current.until }),
      ]);
      const data = await getClientCampaigns({ userId: input.userId, level: input.level, periods, spendByAccount, adAccountId: input.adAccountId, campaignId: input.campaignId });
      const label = labels.get(input.userId);
      if (!label) throw new Error("Cliente não encontrado.");
      const rows = [...data.rows].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || Number(b.active ?? false) - Number(a.active ?? false));
      return {
        client: label.client, userId: input.userId, level: input.level,
        period: { ...periods.current, previous: periods.previous, days: periods.days },
        accounts: data.accounts,
        rows: rows.slice(0, input.limit),
        hiddenRows: Math.max(0, rows.length - input.limit),
        notes: [
          ...(data.truncated ? ["Lista incompleta: mais de 200 linhas por período (ficaram de fora as de menor gasto) ou mais de 500 campanhas ativas (active ausente = status desconhecido)."] : []),
          ...(data.omittedAccounts.length ? [`O cliente tem mais ${data.omittedAccounts.length} conta(s) de anúncio fora desta leitura (as de menor gasto recente); use adAccountId para ler uma delas: ${data.omittedAccounts.map(a => `${a.name ?? a.accountId} (${a.accountId})`).join(", ")}.`] : []),
        ],
      };
    },
  }),
  defineTool({
    name: "list_portfolio_alerts", title: "Alertas da carteira", permission: "marketing:read", write: false,
    description:
      "Alertas pendentes (abertos ou em andamento) dos clientes da carteira, calculados pelos crons: playbook (ROAS, CPA, entrega, criativo), " +
      "drop (queda de performance) e account (conta de anúncio: pagamento, bloqueio, saldo). Agrupados por cliente, críticos primeiro.",
    input: z.object({
      family: z.enum(Object.keys(ALERT_FAMILIES) as [AlertFamily, ...AlertFamily[]]).optional(),
      severity: z.enum(["critical", "warning", "info"]).optional(),
      userId: z.string().uuid().optional().describe("Só os alertas deste cliente."),
      consultantEmail,
      limit: z.number().int().min(1).max(300).default(100),
    }),
    async run(actor, input) {
      if (input.userId) assertClientAccess(actor, input.userId);
      const consultantId = await resolveConsultantScope(actor, input.consultantEmail);
      const { rows, total } = await listPendingAlerts({ consultantId, family: input.family, severity: input.severity, userId: input.userId, limit: input.limit });
      const labels = await loadClientLabels([...new Set(rows.map(r => r.userId))]);
      const byClient = new Map<string, { userId: string; client: string; consultant: string | null; alerts: unknown[] }>();
      for (const r of rows) {
        const label = labels.get(r.userId);
        const group = byClient.get(r.userId) ?? { userId: r.userId, client: label?.client ?? r.userId, consultant: label?.consultant ?? null, alerts: [] };
        group.alerts.push({
          id: r.id, rule: playbookAlertRuleTitle(r.ruleId), severity: r.severity, status: r.status, title: r.title,
          evidence: clip(r.evidence), recommendation: clip(r.recommendation),
          entity: { level: r.entityLevel, id: r.entityId, name: r.entityName }, createdAt: ymd(r.createdAt),
        });
        byClient.set(r.userId, group);
      }
      return { total, shown: rows.length, clients: [...byClient.values()] };
    },
  }),
];

