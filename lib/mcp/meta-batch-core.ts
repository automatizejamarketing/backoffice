/**
 * Regras puras do lote de ações em Meta Ads (pausar, ativar, orçamento diário) do MCP.
 *
 * A prévia lê cada objeto na Meta e decide o plano de cada item: rodar ou pular, com o
 * motivo. O plano guarda o estado lido ("antes") e o alvo, sempre ABSOLUTO (status X,
 * orçamento Y): repetir a execução de um item não muda nada, e a execução (aprovada no
 * backoffice) consegue dizer se alguém mexeu no objeto desde a prévia.
 */

export const BATCH_LEVELS = ["campaign", "adset", "ad"] as const;
export type BatchLevel = (typeof BATCH_LEVELS)[number];

export const BATCH_ACTIONS = ["pause", "activate", "set_daily_budget"] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

export const MAX_BATCH_ITEMS = 100;

/** Orçamento só em moedas com centavos (offset 100 da Meta); as demais ficam para a tela. */
export const BUDGET_CURRENCIES = new Set(["BRL", "USD", "EUR"]);

/** Mudança de orçamento a partir disto (para mais ou para menos) vem com aviso na prévia. */
const LARGE_BUDGET_CHANGE = 0.5;

export type BatchItemInput = {
  userId: string;
  level: BatchLevel;
  id: string;
  action: BatchAction;
  /** Orçamento diário em unidades da moeda da conta (ex.: 50 = R$ 50,00). */
  dailyBudget?: number;
};

/** O que a Meta devolve de um objeto, normalizado. Dinheiro em centavos, como a Meta guarda. */
export type MetaObjectState = {
  id: string;
  name: string | null;
  accountId: string | null;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  campaignId: string | null;
  adsetId: string | null;
  campaignDailyBudget: string | null;
  campaignLifetimeBudget: string | null;
};

export type ItemOutcome = "applied" | "already_applied" | "changed_since_preview" | "failed";

/** Contas de anúncio que o lote pode tocar: conta → moeda, mais o motivo das que ficaram de fora. */
export type ClientAccounts = {
  allowed: ReadonlyMap<string, string | null>;
  /** Conta que a conexão enxerga, mas que também é de cliente fora da carteira de quem pede. */
  shared: ReadonlySet<string>;
  /** A conexão não devolveu conta nenhuma (falha ou nada concedido). */
  listed: boolean;
};

export type PlannedItem = BatchItemInput & {
  name: string | null;
  accountId: string | null;
  currency: string | null;
  campaignId: string | null;
  adsetId: string | null;
  before: { status: string | null; dailyBudget: string | null };
  target: { status?: "ACTIVE" | "PAUSED"; dailyBudget?: string };
  plan: "run" | "skip";
  skipReason?: string;
  warning?: string;
  /** Marcado logo antes da escrita: se a execução morrer depois do POST, a retomada sabe que a mudança é nossa. */
  attempt?: "writing";
  outcome?: ItemOutcome;
  error?: string;
  /** Registro no histórico de um item aplicado; `failed` volta a ser tentado na retomada. */
  audit?: "done" | "failed";
};

const positive = (minor: string | null | undefined) => Number.parseInt(minor ?? "", 10) > 0;

export const toMinor = (value: number) => Math.round(value * 100).toString();
export const toMajor = (minor: string | null | undefined) => (minor == null || minor === "" ? null : Number.parseInt(minor, 10) / 100);

export const actId = (accountId: string | null | undefined) =>
  !accountId ? null : accountId.startsWith("act_") ? accountId : `act_${accountId}`;

/** Chave de um objeto no lote: o mesmo objeto não pode aparecer duas vezes. */
export const objectKey = (item: { level: BatchLevel; id: string }) => `${item.level}:${item.id}`;

const GONE = new Set(["ARCHIVED", "DELETED"]);

const LEVEL_LABEL: Record<BatchLevel, string> = { campaign: "campanha", adset: "conjunto", ad: "anúncio" };

/**
 * Plano de um item a partir do que a Meta devolveu. Um objeto só entra se a conta dele está
 * entre as que a conexão do cliente enxerga E não é também de um cliente fora da carteira de
 * quem pede (conexões de agência enxergam contas de outros negócios).
 */
export function planItem(input: BatchItemInput, object: MetaObjectState | undefined, accounts: ClientAccounts): PlannedItem {
  const accountId = actId(object?.accountId);
  const base: PlannedItem = {
    ...input,
    name: object?.name ?? null,
    accountId,
    currency: accountId ? (accounts.allowed.get(accountId) ?? null) : null,
    campaignId: input.level === "campaign" ? input.id : (object?.campaignId ?? null),
    adsetId: input.level === "adset" ? input.id : (object?.adsetId ?? null),
    before: { status: object?.status ?? null, dailyBudget: object?.dailyBudget ?? null },
    target: {},
    plan: "skip",
  };
  const skip = (skipReason: string): PlannedItem => ({ ...base, skipReason });

  if (!accounts.listed) return skip("Não consegui listar as contas de anúncio deste cliente. Confira a conexão com a Meta.");
  if (!object) return skip(`Não encontrado como ${LEVEL_LABEL[input.level]}, ou a conexão do cliente não tem acesso a ele.`);
  if (accountId && accounts.shared.has(accountId)) return skip("Esta conta de anúncio também é de um cliente fora da sua carteira. Ajuste pela tela.");
  if (!accountId || !accounts.allowed.has(accountId)) return skip("Não pertence a uma conta de anúncio deste cliente.");
  if (GONE.has(object.status ?? "")) return skip("Está arquivado ou excluído.");

  if (input.action === "pause" || input.action === "activate") {
    const status = input.action === "pause" ? "PAUSED" : "ACTIVE";
    if (object.status === status) return skip(status === "PAUSED" ? "Já está pausado." : "Já está ativo.");
    const parentPaused = status === "ACTIVE" && ["CAMPAIGN_PAUSED", "ADSET_PAUSED"].includes(object.effectiveStatus ?? "");
    return {
      ...base, plan: "run", target: { status },
      ...(parentPaused ? { warning: "Fica ativo, mas não entrega enquanto o nível acima estiver pausado." } : {}),
    };
  }

  // set_daily_budget
  if (input.level === "ad") return skip("Anúncio não tem orçamento: ajuste o conjunto ou a campanha.");
  if (input.dailyBudget == null || !(input.dailyBudget >= 1)) return skip("Informe um orçamento diário de pelo menos 1,00.");
  if (!base.currency || !BUDGET_CURRENCIES.has(base.currency)) {
    return skip(`Orçamento pelo MCP só em ${[...BUDGET_CURRENCIES].join(", ")}; esta conta é ${base.currency ?? "de moeda desconhecida"}. Ajuste pela tela.`);
  }
  if (input.level === "campaign" && !positive(object.dailyBudget)) {
    return skip(positive(object.lifetimeBudget)
      ? "A campanha usa orçamento total, não diário. Ajuste pela tela."
      : "O orçamento desta campanha está nos conjuntos (ABO): mude o orçamento de cada conjunto.");
  }
  if (input.level === "adset") {
    if (positive(object.campaignDailyBudget) || positive(object.campaignLifetimeBudget)) {
      return skip("O orçamento está na campanha (CBO): mude o orçamento da campanha.");
    }
    if (!positive(object.dailyBudget)) return skip("O conjunto usa orçamento total, não diário. Ajuste pela tela.");
  }
  const dailyBudget = toMinor(input.dailyBudget);
  if (dailyBudget === object.dailyBudget) return skip("Já está com este orçamento.");
  const previous = Number.parseInt(object.dailyBudget ?? "0", 10);
  const change = previous > 0 ? (Number.parseInt(dailyBudget, 10) - previous) / previous : null;
  return {
    ...base, plan: "run", target: { dailyBudget },
    ...(change != null && Math.abs(change) >= LARGE_BUDGET_CHANGE ? { warning: `Mudança grande no orçamento (${change > 0 ? "+" : ""}${Math.round(change * 100)}%).` } : {}),
  };
}

/**
 * Na execução, com o objeto relido logo antes de escrever: escrever; já está no alvo
 * (`applied` se fomos nós numa execução interrompida depois do POST, senão
 * `already_applied`); ou mudou desde a prévia — aí não escrevemos por cima do que outra
 * pessoa decidiu.
 */
export function decideAtRun(item: PlannedItem, current: MetaObjectState | undefined): "write" | "applied" | "already_applied" | "changed_since_preview" | "missing" {
  if (!current) return "missing";
  const [now, before, target] = item.target.status
    ? [current.status, item.before.status, item.target.status]
    : [current.dailyBudget, item.before.dailyBudget, item.target.dailyBudget];
  if (now === target) return item.attempt === "writing" ? "applied" : "already_applied";
  return now === before ? "write" : "changed_since_preview";
}

/** Corpo da escrita na Meta para um item que vai rodar. */
export function writeBody(item: PlannedItem): URLSearchParams {
  if (item.target.status) return new URLSearchParams({ status: item.target.status });
  if (item.target.dailyBudget) return new URLSearchParams({ daily_budget: item.target.dailyBudget });
  throw new Error("Item sem alvo.");
}

/** Itens planejados para rodar que ainda não têm resultado. */
export const pendingItems = (items: PlannedItem[]) => items.filter(i => i.plan === "run" && !i.outcome);

/** Aplicados na Meta cujo registro no histórico ainda não foi gravado. */
export const auditPendingItems = (items: PlannedItem[]) => items.filter(i => i.outcome === "applied" && i.audit !== "done");

export function batchStatusAfterRun(items: PlannedItem[]): "done" | "partial" {
  return pendingItems(items).length === 0 ? "done" : "partial";
}

/** Linha enxuta de um item para a resposta do MCP: dinheiro em unidades da moeda, não centavos. */
export function describeItem(item: PlannedItem, index: number, client: string) {
  const money = (minor: string | null | undefined) => toMajor(minor);
  return {
    n: index + 1,
    client,
    level: item.level,
    id: item.id,
    name: item.name,
    action: item.action,
    ...(item.target.status ? { from: item.before.status, to: item.target.status } : {}),
    ...(item.action === "set_daily_budget" ? { from: money(item.before.dailyBudget), to: item.target.dailyBudget ? money(item.target.dailyBudget) : item.dailyBudget ?? null, currency: item.currency } : {}),
    ...(item.plan === "skip" ? { skipped: item.skipReason } : {}),
    ...(item.warning ? { warning: item.warning } : {}),
    ...(item.outcome ? { outcome: item.outcome } : {}),
    ...(item.error ? { error: item.error } : {}),
    ...(item.outcome === "applied" && item.audit === "failed" ? { auditPending: true } : {}),
  };
}
