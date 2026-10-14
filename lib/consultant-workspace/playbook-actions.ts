/**
 * Ações sugeridas por cliente — o núcleo puro (sem banco, sem Graph).
 *
 * Cinco situações do dia a dia do gestor de tráfego, cada uma com o porquê em
 * números e os botões de um clique:
 *  - `scale`: insight aberto `playbook.roas_scale` → a Mat pede ao cliente a
 *    aprovação para duplicar com +20% de verba por 30 dias (ele aprova no app);
 *  - `creative_bad`: anúncio que leva verba e não entrega → pausar (Meta), a
 *    Mat pede criativos novos, ou a IA sugere oferta/combo;
 *  - `pixel` e `balance`: checagens ao vivo, só sob demanda em UM cliente →
 *    a Mat manda o passo a passo do pixel ou o link da cobrança na Meta.
 *
 * Os carregadores (banco e Graph) ficam em `playbook-actions-data.ts`; aqui só
 * se decide e se escreve.
 */
import type { AdAccountMoneyState } from "@/lib/backoffice/ad-account-money-types";
import { OBJECTIVE_RESULTS } from "@/lib/meta-business/insights/catalogs/objectives";
import { parseDisplayAmount } from "@/lib/meta-business/marketing/ad-account-money";
import {
  PLAYBOOK_MIN_SPEND,
  PLAYBOOK_ROAS_VALIDATED,
  PLAYBOOK_RULE_CREATIVE_DIAGNOSIS,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_SCALE_BUDGET_FACTOR,
} from "@/lib/playbook-insights/constants";
import { humanize, humanizeName } from "@/components/consultant-workspace/common/signal-helpers";
import { formatMoney, formatRoas, goalKpiForKind } from "./metrics";
import { OUTREACH_MESSAGE_MAX, OUTREACH_TITLE_MAX, type OutreachEntity, type OutreachKind } from "./outreach-core";
import type { PerfTotals, PrimaryKpi, WorkspaceAlert, WorkspaceGoal } from "./types";

// ---------------------------------------------------------------- tipos

export type SuggestionSituation = "scale" | "creative_bad" | "pixel" | "balance";
export type SuggestionSeverity = "critical" | "warning" | "info";

export const SITUATION_LABEL: Record<SuggestionSituation, string> = {
  scale: "Campanha validou",
  creative_bad: "Criativo ruim",
  pixel: "Pixel",
  balance: "Saldo na Meta",
};

export type MatDraft = { kind: OutreachKind; title: string; message: string; entity?: OutreachEntity };

export type SuggestionAction =
  /** Abre o `MetaActionDialog` (prévia ao vivo → confirmar) com "pausar". */
  | { type: "meta_pause"; label: string; entityId: string; entityName: string | null; note: string }
  /** Abre o diálogo da Mat já preenchido. */
  | { type: "mat"; label: string; draft: MatDraft }
  /** IA sugere oferta/combo para estes anúncios; a escolhida vira mensagem da Mat. */
  | { type: "offer_ai"; label: string; adIds: string[]; entity?: OutreachEntity }
  | { type: "link"; label: string; href: string };

export type SuggestedAction = {
  /** Estável entre leituras: `<situação>:<entidade>`. */
  id: string;
  situation: SuggestionSituation;
  severity: SuggestionSeverity;
  title: string;
  /** Por quê, em pt-BR, com números. */
  why: string;
  entity?: {
    level: "campaign" | "adset" | "ad" | "account";
    id: string;
    name: string | null;
    adAccountId?: string | null;
  };
  /** Alertas abertos que esta sugestão trata (para concluir depois de agir). */
  insightIds: string[];
  actions: SuggestionAction[];
};

export type LiveCheckStatus = {
  check: "pixel" | "balance";
  status: "ok" | "problem" | "unknown" | "error";
  /** Uma linha para o gestor ("Pixel ativo, disparou há 2 h", "não consegui checar agora"). */
  summary: string;
  adAccountId: string | null;
  checkedAt: string | null;
};

/** Saudação da Mat: "Oi, Ana!" — sem nome, só "Oi!". */
export type MessageContext = { firstName: string | null };

const SEVERITY_RANK: Record<SuggestionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** A mais grave das duas (null = nenhuma ainda). */
function worse(current: SuggestionSeverity | null, next: SuggestionSeverity): SuggestionSeverity {
  return current && SEVERITY_RANK[current] <= SEVERITY_RANK[next] ? current : next;
}

export function sortSuggestions(list: SuggestedAction[]): SuggestedAction[] {
  return [...list].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---------------------------------------------------------------- texto

export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  if (!first || first.includes("@")) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function greet(ctx: MessageContext) {
  return ctx.firstName ? `Oi, ${ctx.firstName}!` : "Oi!";
}

/** Corta sem quebrar palavra no meio, com reticências. */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}

/** Nome legível para o gestor e o cliente: sem as tags automáticas nem o número da Meta. */
const shortName = (name: string | null | undefined, fallback: string, level: "campaign" | "ad" = "campaign") => {
  if (!name || /^\d{8,}$/.test(name.trim())) return fallback;
  const readable = level === "ad" ? humanize(name).trim().replace(/^automática\b/, "anúncio automático") : humanizeName(name);
  return clip(readable || fallback, 60);
};

const pct = (share: number) => `${Math.round(share * 100)}%`;
const times = (ratio: number) => `${ratio.toFixed(1).replace(".", ",")}×`;
const money0 = (value: number) => formatMoney(value, false);

function draft(kind: OutreachKind, title: string, message: string, entity?: OutreachEntity): MatDraft {
  return {
    kind,
    title: clip(title, OUTREACH_TITLE_MAX),
    message: clip(message, OUTREACH_MESSAGE_MAX),
    ...(entity ? { entity } : {}),
  };
}

const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

// ---------------------------------------------------------------- 1. campanha validou → escalar

export const SCALE_PROPOSAL_DAYS = 30;
const SCALE_PERCENT = Math.round((PLAYBOOK_SCALE_BUDGET_FACTOR - 1) * 100);

export function scaleMessage(ctx: MessageContext, campaign: { name: string; roas: number | null; spend: number | null }): MatDraft {
  const result =
    campaign.roas != null && campaign.spend != null
      ? ` fez ROAS de ${formatRoas(campaign.roas)} nos últimos 30 dias: ${money0(campaign.spend)} investidos viraram cerca de ${money0(campaign.roas * campaign.spend)} em vendas.`
      : campaign.roas != null
        ? ` fez ROAS de ${formatRoas(campaign.roas)}: cada R$ 1 investido voltou ${formatMoney(campaign.roas)} em vendas.`
        : " bateu a meta de retorno do nosso playbook.";
  return draft(
    "scale_approval",
    "sua campanha validou e pode vender mais",
    `${greet(ctx)} A campanha "${campaign.name}"${result} Nossa proposta: duplicar a campanha com ${SCALE_PERCENT}% a mais de verba por ${SCALE_PROPOSAL_DAYS} dias, para vender mais mantendo o resultado. Se fizer sentido, toque no botão e aprove no app.`,
  );
}

export function scaleSuggestions(args: {
  alerts: WorkspaceAlert[];
  /** campanha → conta (`act_…`), para o app achar a campanha. */
  accountByCampaign?: ReadonlyMap<string, string>;
  ctx: MessageContext;
}): SuggestedAction[] {
  const byCampaign = new Map<string, WorkspaceAlert[]>();
  for (const alert of args.alerts) {
    if (alert.ruleId !== PLAYBOOK_RULE_ROAS_SCALE || alert.entityLevel !== "campaign" || !alert.entityId) continue;
    const list = byCampaign.get(alert.entityId) ?? [];
    list.push(alert);
    byCampaign.set(alert.entityId, list);
  }
  const out: SuggestedAction[] = [];
  for (const [campaignId, alerts] of byCampaign) {
    const latest = [...alerts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    const roas = num(latest.metrics.purchaseRoas);
    const spend = num(latest.metrics.spend);
    // O insight já aplicou o playbook; aqui só se descarta o que não bate mais (ROAS ≥ 5 e gasto ≥ R$ 50).
    if (roas != null && roas < PLAYBOOK_ROAS_VALIDATED) continue;
    if (spend != null && spend < PLAYBOOK_MIN_SPEND) continue;
    const name = shortName(latest.entityName, "Campanha sem nome");
    const accountId = args.accountByCampaign?.get(campaignId) ?? null;
    const adAccountId = accountId ? (accountId.startsWith("act_") ? accountId : `act_${accountId}`) : undefined;
    const message = scaleMessage(args.ctx, { name, roas, spend });
    out.push({
      id: `scale:${campaignId}`,
      situation: "scale",
      severity: "info",
      title: `Escalar "${name}"`,
      why: [
        roas != null ? `ROAS ${formatRoas(roas)}` : "ROAS validado",
        spend != null ? ` com ${money0(spend)} investidos nos últimos 30 dias` : "",
        ` (playbook: ≥ ${formatRoas(PLAYBOOK_ROAS_VALIDATED)} e ≥ ${money0(PLAYBOOK_MIN_SPEND)}).`,
        ` Proposta: duplicar com +${SCALE_PERCENT}% de verba por ${SCALE_PROPOSAL_DAYS} dias — o cliente aprova no app.`,
      ].join(""),
      entity: { level: "campaign", id: campaignId, name, adAccountId: adAccountId ?? null },
      insightIds: alerts.map((alert) => alert.id),
      actions: [
        {
          type: "mat",
          label: "Pedir aprovação para escalar",
          draft: { ...message, entity: { level: "campaign", id: campaignId, name, ...(adAccountId ? { adAccountId } : {}) } },
        },
      ],
    });
  }
  return out;
}

// ---------------------------------------------------------------- 2. criativo ruim

/** Parcela mínima da verba para um custo alto pesar. */
export const CREATIVE_BAD_MIN_SHARE = 0.2;
/** Custo por resultado a partir de quanto × a referência (meta ou média da conta). */
export const CREATIVE_BAD_COST_FACTOR = 1.3;
/** Gasto sem nenhum resultado a partir do qual o anúncio é ruim. */
export const CREATIVE_BAD_MIN_SPEND_NO_RESULT = PLAYBOOK_MIN_SPEND;
export const CREATIVE_BAD_MAX = 3;

/** O mínimo de um anúncio do dossiê (`getDossierAds`) que as regras usam. */
export type AdPerformance = {
  adId: string;
  name: string;
  campaignName: string | null;
  status: string | null;
  current: PerfTotals;
  kpi: PrimaryKpi;
  spendShare: number;
};

const INACTIVE_AD_STATUS = new Set(["PAUSED", "ARCHIVED", "DELETED"]);

/** Custo por resultado da conta no período, para o mesmo tipo de resultado. */
export function blendedCost(ads: AdPerformance[], kind: PrimaryKpi["kind"]): number | null {
  let spend = 0;
  let count = 0;
  for (const ad of ads) {
    if (ad.kpi.kind !== kind) continue;
    spend += ad.current.spend;
    count += ad.kpi.count;
  }
  return count > 0 ? spend / count : null;
}

/** Meta de custo que vale para este tipo de resultado (CPA para compras, CPL para leads…). ROAS não entra. */
export function costGoalFor(goal: WorkspaceGoal | undefined, kind: PrimaryKpi["kind"]): number | null {
  if (!goal || goal.kpi === "roas" || !(goal.target > 0)) return null;
  return goal.kpi === goalKpiForKind(kind) ? goal.target : null;
}

export type CreativeVerdict = {
  ad: AdPerformance;
  severity: SuggestionSeverity;
  reasons: string[];
  diagnosisIds: string[];
};

export function evaluateCreative(args: {
  ad: AdPerformance;
  ads: AdPerformance[];
  goal: WorkspaceGoal | undefined;
  diagnoses: WorkspaceAlert[];
  days: number;
}): CreativeVerdict | null {
  const { ad } = args;
  if (ad.current.spend <= 0 || (ad.status && INACTIVE_AD_STATUS.has(ad.status))) return null;
  const reasons: string[] = [];
  let severity: SuggestionSeverity | null = null;
  const resultLabel = ad.kpi.label.toLowerCase();

  if (ad.kpi.count === 0 && ad.current.spend >= CREATIVE_BAD_MIN_SPEND_NO_RESULT) {
    reasons.push(`Gastou ${money0(ad.current.spend)} (${pct(ad.spendShare)} da verba) em ${args.days} dias e não trouxe ${resultLabel}.`);
    severity = worse(severity, ad.spendShare >= CREATIVE_BAD_MIN_SHARE ? "critical" : "warning");
  } else if (ad.kpi.cost != null && ad.kpi.count > 0 && ad.spendShare >= CREATIVE_BAD_MIN_SHARE) {
    const goalTarget = costGoalFor(args.goal, ad.kpi.kind);
    const reference = goalTarget ?? blendedCost(args.ads, ad.kpi.kind);
    if (reference != null && reference > 0 && ad.kpi.cost >= CREATIVE_BAD_COST_FACTOR * reference) {
      const ratio = ad.kpi.cost / reference;
      const against = goalTarget != null ? `a meta de ${formatMoney(reference)}` : `a média da conta (${formatMoney(reference)})`;
      reasons.push(`${ad.kpi.costLabel} de ${formatMoney(ad.kpi.cost)} — ${times(ratio)} ${against} — levando ${pct(ad.spendShare)} da verba.`);
      severity = worse(severity, ratio >= 2 ? "critical" : "warning");
    }
  }

  const diagnoses = args.diagnoses.filter(
    (alert) =>
      alert.ruleId === PLAYBOOK_RULE_CREATIVE_DIAGNOSIS &&
      alert.entityId === ad.adId &&
      (alert.metrics.likelyContributor === true || alert.actionType === "review_creative"),
  );
  if (diagnoses.length > 0) {
    const evidence = diagnoses[0].evidence ? clip(humanize(diagnoses[0].evidence), 220) : "a peça parece estar pesando no resultado.";
    reasons.push(`Diagnóstico do criativo: ${evidence}`);
    severity = worse(severity, "warning");
  }

  if (!severity) return null;
  return { ad, severity, reasons, diagnosisIds: diagnoses.map((alert) => alert.id) };
}

export function creativeRefreshMessage(ctx: MessageContext, ad: AdPerformance, days: number): MatDraft {
  const name = shortName(ad.name, "um dos anúncios", "ad");
  const result = ad.kpi.label.toLowerCase();
  const performance =
    ad.kpi.count === 0
      ? `gastou ${money0(ad.current.spend)} nos últimos ${days} dias sem trazer ${result}`
      : `está com ${ad.kpi.costLabel} de ${formatMoney(ad.kpi.cost)} nos últimos ${days} dias, acima do que queremos`;
  return draft(
    "creative_refresh",
    "precisamos de fotos ou vídeos novos",
    `${greet(ctx)} O anúncio "${name}" ${performance}, então vamos renovar o criativo. Pode mandar aqui 3 fotos ou vídeos curtos novos? Vale prato ou produto em destaque, boa luz, de preferência na vertical, e se tiver uma oferta da semana, melhor ainda. Com o material a gente sobe a versão nova em seguida.`,
  );
}

export function creativeBadSuggestions(args: {
  ads: AdPerformance[];
  alerts: WorkspaceAlert[];
  goal: WorkspaceGoal | undefined;
  days: number;
  ctx: MessageContext;
}): SuggestedAction[] {
  const verdicts: CreativeVerdict[] = [];
  for (const ad of args.ads) {
    const verdict = evaluateCreative({ ad, ads: args.ads, goal: args.goal, diagnoses: args.alerts, days: args.days });
    if (verdict) verdicts.push(verdict);
  }
  return verdicts
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.ad.current.spend - a.ad.current.spend)
    .slice(0, CREATIVE_BAD_MAX)
    .map(({ ad, severity, reasons, diagnosisIds }) => {
      const name = shortName(ad.name, "Anúncio sem nome", "ad");
      return {
        id: `creative_bad:${ad.adId}`,
        situation: "creative_bad" as const,
        severity,
        title: `Criativo ruim: "${name}"`,
        why: reasons.join(" "),
        entity: { level: "ad" as const, id: ad.adId, name },
        insightIds: diagnosisIds,
        actions: [
          { type: "meta_pause" as const, label: "Pausar anúncio", entityId: ad.adId, entityName: name, note: clip(`Criativo ruim (ações sugeridas): ${reasons[0]}`, 300) },
          { type: "mat" as const, label: "Pedir criativos novos", draft: { ...creativeRefreshMessage(args.ctx, ad, args.days), entity: { level: "ad" as const, id: ad.adId, name } } },
          { type: "offer_ai" as const, label: "Sugerir oferta/combo", adIds: [ad.adId], entity: { level: "ad" as const, id: ad.adId, name } },
        ],
      };
    });
}

/** Mensagem da Mat a partir da oferta escolhida pelo gestor (IA ou editada). */
export function offerMessage(
  ctx: MessageContext,
  offer: { name: string; composition: string; priceHint: string; whyItWorks: string },
): MatDraft {
  const price = offer.priceHint.trim() ? ` Preço sugerido: ${offer.priceHint.trim().replace(/\.$/, "")}.` : "";
  return draft(
    "offer_suggestion",
    "ideia de oferta para vender mais",
    `${greet(ctx)} Para melhorar o anúncio que está fraco, queremos testar uma oferta: ${offer.name.trim()} — ${offer.composition.trim().replace(/\.$/, "")}.${price} Por quê: ${offer.whyItWorks.trim().replace(/\.$/, "")}. Topa? Responda aqui com OK (ou ajuste o que quiser) que a gente monta o anúncio novo.`,
  );
}

// ---------------------------------------------------------------- 3. pixel (ao vivo)

export const PIXEL_STALE_DAYS = 3;

export type PixelReading = { id: string; name: string | null; lastFiredTime: string | null; isUnavailable: boolean };

/** Campanha de vendas com gasto no período (dados que já temos no banco). */
export type SalesCampaignSpend = { campaignId: string; name: string; spend: number; purchases: number };

export function isSalesObjective(objective: string | null | undefined): boolean {
  if (!objective) return false;
  return OBJECTIVE_RESULTS[objective.toUpperCase()]?.hasValue === true;
}

export type PixelVerdict = {
  status: "ok" | "problem";
  problem: "no_pixel" | "unavailable" | "stale" | "no_purchases" | null;
  severity: SuggestionSeverity;
  why: string;
  summary: string;
  pixel: PixelReading | null;
  daysSinceFired: number | null;
};

const DAY_MS = 86_400_000;

export function evaluatePixel(input: {
  pixels: PixelReading[];
  salesCampaigns: SalesCampaignSpend[];
  days: number;
  now: Date;
}): PixelVerdict {
  const selling = input.salesCampaigns.filter((campaign) => campaign.spend > 0);
  const salesSpend = selling.reduce((sum, campaign) => sum + campaign.spend, 0);
  const salesLine =
    selling.length > 0
      ? `${selling.length === 1 ? `a campanha de vendas "${shortName(selling[0].name, "sem nome")}" gastou` : `${selling.length} campanhas de vendas gastaram`} ${money0(salesSpend)} em ${input.days} dias`
      : null;

  if (input.pixels.length === 0) {
    return {
      status: "problem",
      problem: "no_pixel",
      severity: salesLine ? "critical" : "info",
      why: salesLine
        ? `A conta não tem pixel, e ${salesLine}: a Meta otimiza sem saber quem comprou.`
        : "A conta de anúncios não tem pixel. Antes de rodar campanha de vendas, ele precisa estar instalado no site ou cardápio.",
      summary: "Sem pixel na conta",
      pixel: null,
      daysSinceFired: null,
    };
  }

  const usable = input.pixels.filter((pixel) => !pixel.isUnavailable);
  if (usable.length === 0) {
    const name = input.pixels[0].name ?? input.pixels[0].id;
    return {
      status: "problem",
      problem: "unavailable",
      severity: salesLine ? "critical" : "warning",
      why: `O pixel "${name}" está indisponível na Meta${salesLine ? `, e ${salesLine}` : ""}.`,
      summary: "Pixel indisponível",
      pixel: input.pixels[0],
      daysSinceFired: null,
    };
  }

  const fired = (pixel: PixelReading) => (pixel.lastFiredTime ? Date.parse(pixel.lastFiredTime) : Number.NaN);
  const best = [...usable].sort((a, b) => (Number.isNaN(fired(b)) ? -1 : Number.isNaN(fired(a)) ? 1 : fired(b) - fired(a)))[0];
  const lastFired = fired(best);
  const ageMs = Number.isNaN(lastFired) ? null : input.now.getTime() - lastFired;
  const daysSinceFired = ageMs == null ? null : Math.floor(ageMs / DAY_MS);
  const name = best.name ?? best.id;

  if (salesLine && (ageMs == null || ageMs > PIXEL_STALE_DAYS * DAY_MS)) {
    return {
      status: "problem",
      problem: "stale",
      severity: "critical",
      why:
        ageMs == null
          ? `O pixel "${name}" nunca disparou, mas ${salesLine}.`
          : `O pixel "${name}" não dispara há ${daysSinceFired} dias, mas ${salesLine}.`,
      summary: ageMs == null ? "Pixel nunca disparou" : `Pixel parado há ${daysSinceFired} dias`,
      pixel: best,
      daysSinceFired,
    };
  }

  const noPurchases = selling.filter((campaign) => campaign.spend >= PLAYBOOK_MIN_SPEND && campaign.purchases === 0);
  if (noPurchases.length > 0) {
    const top = [...noPurchases].sort((a, b) => b.spend - a.spend)[0];
    return {
      status: "problem",
      problem: "no_purchases",
      severity: "warning",
      why: `O pixel dispara, mas a campanha de vendas "${shortName(top.name, "sem nome")}" gastou ${money0(top.spend)} em ${input.days} dias sem nenhuma compra registrada — confira se o evento Compra está configurado.`,
      summary: "Pixel ativo, mas sem compras registradas",
      pixel: best,
      daysSinceFired,
    };
  }

  return {
    status: "ok",
    problem: null,
    severity: "info",
    why: "",
    summary:
      daysSinceFired == null
        ? `Pixel "${name}" na conta (sem campanha de vendas gastando)`
        : `Pixel "${name}" ativo · último disparo ${daysSinceFired === 0 ? "hoje" : daysSinceFired === 1 ? "ontem" : `há ${daysSinceFired} dias`}`,
    pixel: best,
    daysSinceFired,
  };
}

export function pixelSetupMessage(ctx: MessageContext, verdict: PixelVerdict): MatDraft {
  const pixelName = verdict.pixel?.name ? ` "${verdict.pixel.name}"` : "";
  const problem: Record<NonNullable<PixelVerdict["problem"]>, string> = {
    no_pixel: "a sua conta de anúncios ainda não tem o pixel da Meta",
    unavailable: `o pixel${pixelName} da sua conta está indisponível na Meta`,
    stale: `o pixel${pixelName} parou de enviar dados para a Meta`,
    no_purchases: `o pixel${pixelName} está ativo, mas nenhuma compra está chegando na Meta`,
  };
  const steps =
    verdict.problem === "no_purchases"
      ? "1) abra o Gerenciador de Eventos: business.facebook.com/events_manager; 2) escolha o pixel e veja se o evento Compra aparece; 3) se não aparecer, ative o evento Compra na sua plataforma de pedidos ou loja e faça um pedido teste."
      : "1) abra o Gerenciador de Eventos: business.facebook.com/events_manager; 2) clique em Conectar dados > Web e crie ou escolha o pixel; 3) instale pela sua plataforma de pedidos ou loja (a maioria tem o campo \"Pixel da Meta\": é só colar o ID) e faça um pedido teste para conferir.";
  return draft(
    "pixel_setup",
    verdict.problem === "no_pixel" ? "falta instalar o pixel da Meta" : "o pixel da Meta precisa de atenção",
    `${greet(ctx)} Vimos que ${problem[verdict.problem ?? "stale"]}. Sem isso a Meta não sabe quem comprou e a campanha de vendas fica no escuro. Para resolver: ${steps} Se travar em algum passo, responda aqui que a gente te ajuda.`,
  );
}

export function pixelSuggestion(args: {
  verdict: PixelVerdict;
  adAccountId: string;
  accountName: string | null;
  ctx: MessageContext;
}): SuggestedAction | null {
  const { verdict } = args;
  if (verdict.status !== "problem") return null;
  return {
    id: `pixel:${args.adAccountId}`,
    situation: "pixel",
    severity: verdict.severity,
    title: verdict.problem === "no_pixel" ? "Pixel não instalado" : verdict.summary,
    why: verdict.why,
    entity: { level: "account", id: args.adAccountId, name: args.accountName, adAccountId: args.adAccountId },
    insightIds: [],
    actions: [{ type: "mat", label: "Mandar instruções do pixel", draft: pixelSetupMessage(args.ctx, verdict) }],
  };
}

// ---------------------------------------------------------------- 4. saldo (ao vivo)

export const BALANCE_MIN_BRL = 50;
export const BALANCE_MIN_DAYS = 3;
/** `account_status` da Meta: 3 = UNSETTLED (não quitada), 9 = IN_GRACE_PERIOD (carência). */
export const ACCOUNT_STATUS_UNSETTLED = 3;
export const ACCOUNT_STATUS_GRACE = 9;
/** `disable_reason` 3 = RISK_PAYMENT (desativada por pagamento). */
export const DISABLE_REASON_PAYMENT = 3;

export type BalanceCheckInput = {
  currency: string | null;
  isPrepaid: boolean | null;
  money: AdAccountMoneyState;
  accountStatus: number | null;
  disableReason: number | null;
  /** Em reais (unidade maior). */
  amountSpent: number | null;
  /** Em reais; null/0 = sem limite. */
  spendCap: number | null;
  /** Média diária dos últimos 7 dias fechados, em reais. */
  avgDailySpend7d: number;
};

export type BalanceProblem = "prepaid_empty" | "prepaid_low" | "unsettled" | "grace_period" | "payment_disabled" | "spend_cap";

export type BalanceVerdict = {
  status: "ok" | "problem" | "unknown";
  severity: SuggestionSeverity;
  problems: BalanceProblem[];
  why: string;
  summary: string;
  available: number | null;
  runwayDays: number | null;
};

export function evaluateBalance(input: BalanceCheckInput): BalanceVerdict {
  const problems: BalanceProblem[] = [];
  const reasons: string[] = [];
  let severity: SuggestionSeverity | null = null;
  const avg = input.avgDailySpend7d > 0 ? input.avgDailySpend7d : 0;
  const isBrl = !input.currency || input.currency === "BRL";

  if (input.disableReason === DISABLE_REASON_PAYMENT) {
    problems.push("payment_disabled");
    reasons.push("A Meta desativou a conta por problema de pagamento.");
    severity = worse(severity, "critical");
  }
  if (input.accountStatus === ACCOUNT_STATUS_UNSETTLED) {
    problems.push("unsettled");
    reasons.push("A conta está como não quitada na Meta (pagamento recusado ou fatura em aberto): os anúncios param até pagar.");
    severity = worse(severity, "critical");
  } else if (input.accountStatus === ACCOUNT_STATUS_GRACE) {
    problems.push("grace_period");
    reasons.push("A conta está em período de carência: tem pagamento atrasado e a Meta suspende se não for pago.");
    severity = worse(severity, "warning");
  }

  let available: number | null = null;
  let runwayDays: number | null = null;
  if (input.isPrepaid && input.money.kind === "available") {
    available = parseDisplayAmount(input.money.display);
    if (available != null) {
      runwayDays = avg > 0 ? available / avg : null;
      const pace = avg > 0 ? ` no ritmo dos últimos 7 dias (${money0(avg)}/dia)` : "";
      if (available <= 0) {
        problems.push("prepaid_empty");
        reasons.push(`O saldo pré-pago acabou (${input.money.display})${avg > 0 ? `, e a conta vinha gastando ${money0(avg)}/dia` : ""}.`);
        severity = worse(severity, "critical");
      } else if ((isBrl && available < BALANCE_MIN_BRL) || (runwayDays != null && runwayDays < BALANCE_MIN_DAYS)) {
        problems.push("prepaid_low");
        const runway = runwayDays != null ? `, dá para ~${Math.max(0, Math.floor(runwayDays))} ${Math.floor(runwayDays) === 1 ? "dia" : "dias"}${pace}` : "";
        reasons.push(`Saldo pré-pago baixo: ${input.money.display}${runway}.`);
        severity = worse(severity, runwayDays != null && runwayDays < 1 ? "critical" : "warning");
      }
    }
  }

  if (input.spendCap && input.spendCap > 0 && input.amountSpent != null) {
    const remaining = input.spendCap - input.amountSpent;
    if (remaining <= 0) {
      problems.push("spend_cap");
      reasons.push(`Atingiu o limite de gastos da conta (${money0(input.spendCap)}): a Meta para tudo até aumentar o limite.`);
      severity = worse(severity, "critical");
    } else if (avg > 0 && remaining < avg * BALANCE_MIN_DAYS) {
      problems.push("spend_cap");
      reasons.push(`Faltam ${money0(remaining)} para o limite de gastos da conta (${money0(input.spendCap)}), ~${Math.floor(remaining / avg)} dias no ritmo atual.`);
      severity = worse(severity, "warning");
    }
  }

  if (problems.length > 0) {
    const short: Record<BalanceProblem, string> = {
      prepaid_empty: "Saldo pré-pago acabou",
      prepaid_low: `Saldo pré-pago baixo${runwayDays != null ? ` (~${Math.max(0, Math.floor(runwayDays))} ${Math.floor(runwayDays) === 1 ? "dia" : "dias"})` : ""}`,
      payment_disabled: "Conta desativada por pagamento",
      unsettled: "Pagamento pendente na Meta",
      grace_period: "Pagamento atrasado (carência)",
      spend_cap: "Limite de gastos da conta",
    };
    return { status: "problem", severity: severity ?? "warning", problems, why: reasons.join(" "), summary: short[problems[0]], available, runwayDays };
  }
  if (input.money.kind === "blocked") {
    return {
      status: "unknown",
      severity: "info",
      problems,
      why: "",
      summary: "Sem permissão para ler o saldo desta conta (a conexão precisa de acesso de administrador).",
      available,
      runwayDays,
    };
  }
  const summary =
    input.money.kind === "available"
      ? `Saldo pré-pago ${input.money.display}${runwayDays != null ? ` · ~${Math.floor(runwayDays)} dias` : ""}`
      : input.money.kind === "owed"
        ? `Conta pós-paga · fatura em aberto ${formatMoney(input.money.amountMajor)}`
        : "Conta sem pendência de pagamento";
  return { status: "ok", severity: "info", problems, why: "", summary, available, runwayDays };
}

/**
 * Link da Central de Cobranças DESTA conta (mesma lógica do app,
 * `metaBillingSettingsUrl` em `lib/meta-business/marketing/ad-account-billing.ts`
 * do frontend): `asset_id` é o id numérico sem `act_`.
 */
export function metaBillingSettingsUrl(adAccountId: string, businessId?: string | null): string {
  const assetId = adAccountId.replace(/^act_/, "");
  const params = new URLSearchParams({ asset_id: assetId });
  if (businessId) params.set("business_id", businessId);
  params.set("placement", "BILLING_HUB");
  return `https://adsmanager.facebook.com/adsmanager/billing_hub/payment_settings?${params.toString()}`;
}

export function balanceMessage(ctx: MessageContext, verdict: BalanceVerdict, billingUrl: string): MatDraft {
  const has = (problem: BalanceProblem) => verdict.problems.includes(problem);
  const [title, what, fix] = has("prepaid_empty")
    ? ["o saldo da conta de anúncios acabou", "o saldo pré-pago da sua conta de anúncios acabou, então os anúncios param de rodar", "adicione saldo"]
    : has("payment_disabled") || has("unsettled")
      ? ["pagamento pendente na conta de anúncios", "a Meta está com um pagamento pendente na sua conta de anúncios e os anúncios param até ele ser resolvido", "atualize a forma de pagamento ou quite o valor em aberto"]
      : has("grace_period")
        ? ["pagamento atrasado na conta de anúncios", "a sua conta de anúncios está com um pagamento atrasado; se não for pago, a Meta suspende os anúncios", "atualize a forma de pagamento ou quite o valor em aberto"]
        : has("spend_cap")
          ? ["limite de gastos da conta de anúncios", "a sua conta de anúncios está no limite de gastos e os anúncios param quando ele é atingido", "aumente ou remova o limite de gastos da conta"]
          : ["o saldo de anúncios está acabando", `o saldo pré-pago da sua conta de anúncios está acabando${verdict.runwayDays != null ? (Math.floor(verdict.runwayDays) <= 1 ? " (dá para mais ou menos 1 dia)" : ` (dá para uns ${Math.floor(verdict.runwayDays)} dias)`) : ""}`, "adicione saldo"];
  return draft(
    "ad_balance",
    title,
    `${greet(ctx)} Passando para avisar que ${what}. Para resolver, ${fix} direto na Meta por este link: ${billingUrl} — a gente não consegue pagar por você, mas assim que estiver ok os anúncios voltam sozinhos. Qualquer dúvida, responda aqui.`,
  );
}

export function balanceSuggestion(args: {
  verdict: BalanceVerdict;
  adAccountId: string;
  accountName: string | null;
  ctx: MessageContext;
}): SuggestedAction | null {
  const { verdict } = args;
  if (verdict.status !== "problem") return null;
  const url = metaBillingSettingsUrl(args.adAccountId);
  return {
    id: `balance:${args.adAccountId}`,
    situation: "balance",
    severity: verdict.severity,
    title: verdict.problems.includes("prepaid_empty")
      ? "Saldo acabou"
      : verdict.problems.some((problem) => problem === "unsettled" || problem === "payment_disabled" || problem === "grace_period")
        ? "Pagamento pendente na Meta"
        : verdict.problems.includes("spend_cap")
          ? "Limite de gastos da conta"
          : "Saldo acabando",
    why: verdict.why,
    entity: { level: "account", id: args.adAccountId, name: args.accountName, adAccountId: args.adAccountId },
    insightIds: [],
    actions: [
      { type: "mat", label: "Mandar link da cobrança", draft: balanceMessage(args.ctx, verdict, url) },
      { type: "link", label: "Abrir cobrança na Meta", href: url },
    ],
  };
}
