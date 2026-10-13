import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getWorkspaceClientDetail } from "@/lib/consultant-workspace/data";
import { getDossierAds } from "@/lib/consultant-workspace/journey-data";
import { applyWorkspaceOp, readWorkspaceState } from "@/lib/consultant-workspace/state";
import { GOAL_KPI_LABEL, formatMoney, formatRoas } from "@/lib/consultant-workspace/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "anthropic/claude-sonnet-5.5";

/**
 * Análise curta para o dossiê do gestor: lê os mesmos números da área de
 * Tráfego (banco, sem Graph) e pede ao modelo uma leitura acionável em pt-BR.
 * Guarda só a última análise por cliente.
 */
export async function POST(request: Request) {
  const { userId, days: rawDays = 7 } = (await request.json()) as { userId: string; days?: number };
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:write");
  if (!authz.ok) return authz.response;
  const actor = authz.actor;
  const days = Math.min(Math.max(Number(rawDays) || 7, 1), 90);
  // Cada análise é uma chamada paga ao modelo.
  const limit = checkRateLimit(`consultant-ai-analysis:${actor.email}`, { limit: 30, windowSeconds: 3600 });
  if (!limit.success) {
    return NextResponse.json({ error: `Limite de análises por hora atingido. Tente em ${limit.retryAfterSeconds}s.` }, { status: 429 });
  }

  const [detail, ads, store] = await Promise.all([
    getWorkspaceClientDetail(actor, userId, days),
    getDossierAds(userId, days),
    readWorkspaceState({ userIds: [userId] }),
  ]);
  if (!detail) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
  const { client, campaigns, alerts } = detail;
  const goal = store.goals[userId];

  const kpiLine = (label: string, kpi: typeof client.perf.kpi, spend: number) =>
    `${label}: gasto ${formatMoney(spend)}, ${kpi.count} ${kpi.label.toLowerCase()}, ${kpi.costLabel} ${formatMoney(kpi.cost)}${kpi.roas != null ? `, ROAS ${formatRoas(kpi.roas)}` : ""}`;

  const facts = [
    `Cliente: ${client.displayName} (plano ${client.plan.tier}).`,
    kpiLine(`Últimos ${days} dias`, client.perf.kpi, client.perf.current.spend),
    kpiLine(`${days} dias anteriores`, client.perf.previousKpi, client.perf.previous.spend),
    goal
      ? `Meta combinada: ${GOAL_KPI_LABEL[goal.kpi]} ${goal.kpi === "roas" ? formatRoas(goal.target) : formatMoney(goal.target)}${goal.monthlyBudget ? `, verba mensal ${formatMoney(goal.monthlyBudget)}` : ""}. Gasto no mês até ontem: ${formatMoney(client.perf.monthToDateSpend)}.`
      : "Sem meta combinada com o cliente.",
    "Campanhas (período atual vs anterior):",
    ...campaigns.slice(0, 8).map(
      (c) =>
        `- ${c.name} [${c.status ?? "?"}]: gasto ${formatMoney(c.current.spend)} (antes ${formatMoney(c.previous.spend)}), ${c.kpi.count} ${c.kpi.label.toLowerCase()}, ${c.kpi.costLabel} ${formatMoney(c.kpi.cost)} (antes ${formatMoney(c.previousKpi.cost)})`,
    ),
    "Anúncios com mais gasto:",
    ...ads.slice(0, 8).map(
      (a) =>
        `- ${a.name} (${a.isVideo ? "vídeo" : "imagem"}, campanha ${a.campaignName ?? "?"}): ${Math.round(a.spendShare * 100)}% do gasto, ${a.kpi.count} ${a.kpi.label.toLowerCase()}, ${a.kpi.costLabel} ${formatMoney(a.kpi.cost)} (antes ${formatMoney(a.previousKpi.cost)})`,
    ),
    "Alertas abertos do playbook:",
    ...alerts.slice(0, 6).map((a) => `- ${a.ruleTitle}: ${a.evidence} Recomendação: ${a.recommendation}`),
  ].join("\n");

  try {
    const result = await generateText({
      model: gateway(MODEL),
      maxOutputTokens: 4000,
      system:
        "Você é um gestor de tráfego sênior de uma agência que atende restaurantes e pequenos negócios no Brasil. Escreva em português do Brasil, direto, sem jargão desnecessário e sem inventar números: use só os fatos fornecidos. Formato exato, em texto simples com estes 4 títulos em negrito markdown: **O que aconteceu** (2 frases), **Por quê (hipótese)** (1-2 frases), **O que fazer agora** (até 3 itens com '- ', cada um uma ação concreta: otimizar, pausar criativo, trocar criativo, ajustar verba ou falar com o cliente), **Para dizer ao cliente** (1 frase que caiba no WhatsApp).",
      prompt: facts,
    });
    const analysis = { text: result.text.trim(), model: MODEL, periodDays: days };
    await applyWorkspaceOp(actor, { op: "saveAiAnalysis", userId, analysis });
    return NextResponse.json({ ...analysis, generatedAt: new Date().toISOString(), by: actor.email });
  } catch (error) {
    console.error("[consultant-workspace ai-analysis]", error);
    return NextResponse.json({ error: "Falha ao gerar a análise" }, { status: 502 });
  }
}
