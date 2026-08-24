/**
 * Postura de cota do coletor (§5, "Rate limit", do plano
 * `docs/plans/campaign-tracking-foundation.md`).
 *
 * A licença Meta deste app é throttled por TAXA DE ERRO — restrição herdada das
 * ADRs 0001/0010 —, então tomar um 429 é caro de um jeito que nenhum retry
 * conserta. A coleta por isso não espera a Meta dizer "não": lê a utilização que
 * ela anuncia em cada resposta e para ANTES, deixando a conta com cobertura
 * `partial` para o próximo disparo do cron completar.
 *
 * Puro de propósito: recebe `Headers` e devolve números. O executor decide o que
 * fazer com eles; quem testa a decisão não precisa de rede. É também por isso
 * que `parseRateLimitHeaders` (de `lib/meta-business/error.ts`) não é reusado
 * aqui: ele lê os mesmos headers, mas só o tempo de espera de quem JÁ tomou
 * bloqueio — nunca a utilização, que é a informação que permite parar antes —,
 * e mora num módulo que arrasta `next/server` para dentro de uma costura pura.
 *
 * Os quatro headers que a Meta usa para dizer quanto já foi gasto:
 *
 * - `X-Business-Use-Case-Usage` — o principal, POR CONTA DE ANÚNCIO (o rate
 *   limit BUC é por conta, e é por isso que paralelizar entre contas não compete
 *   pela mesma cota). Traz `call_count`, `total_cputime` e `total_time`, todos
 *   já em PERCENTUAL do permitido, mais `estimated_time_to_regain_access` em
 *   minutos quando o bloqueio já aconteceu.
 * - `X-FB-Ads-Insights-Throttle` — cota específica de insights, em
 *   `app_id_util_pct` / `acc_id_util_pct`.
 * - `X-Ad-Account-Usage` — cota antiga por conta (`acc_id_util_pct`).
 * - `X-App-Usage` — cota do app inteiro; estourar aqui derruba todas as contas,
 *   então também interrompe.
 */

/** O que a Meta anunciou sobre a cota na última resposta lida. */
export type QuotaUsage = {
  /** Maior utilização percentual anunciada; `null` = a Meta não disse nada. */
  utilizationPercent: number | null;
  /** Espera sugerida pela Meta quando o bloqueio já existe, em ms. */
  estimatedRegainMs: number | null;
  /**
   * Parcela do percentual acima que veio inequivocamente da cota do app.
   * Ausente = nenhum header global foi observado. Separar o escopo permite
   * interromper a run inteira sem tratar um BUC por conta como bloqueio global.
   */
  appUtilizationPercent?: number | null;
};

/** Resposta que não trouxe header de uso nenhum. */
export const UNKNOWN_QUOTA_USAGE: QuotaUsage = {
  utilizationPercent: null,
  estimatedRegainMs: null,
};

/**
 * Onde a coleta desiste da conta. 80 % deixa margem para a próxima conta do
 * lote e para os crons de negócio que compartilham a cota do app — a coleta é
 * diária e retomável, um 429 não é.
 */
export const QUOTA_STOP_THRESHOLD_PERCENT = 80;

/** Percentuais que aparecem dentro de `X-Business-Use-Case-Usage`/`X-App-Usage`. */
const USAGE_PERCENT_KEYS = [
  "call_count",
  "total_cputime",
  "total_time",
  "acc_id_util_pct",
  "app_id_util_pct",
] as const;

/** Percentuais que, nos headers globais, pertencem ao app inteiro. */
const APP_USAGE_PERCENT_KEYS = [
  "call_count",
  "total_cputime",
  "total_time",
  "app_id_util_pct",
] as const;

function parseJsonHeader(
  headers: Headers,
  name: string,
): unknown | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // Header malformado é ruído da Meta, não motivo para derrubar a coleta.
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : null;
}

function highest(current: number | null, candidate: number | null): number | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  return Math.max(current, candidate);
}

function highestUsagePercent(
  entry: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  let value: number | null = null;
  for (const key of keys) {
    value = highest(value, finitePositive(entry[key]));
  }
  return value;
}

/** Percentuais e tempo de espera de um objeto de uso, seja de que header for. */
function readUsageEntry(entry: unknown, into: QuotaUsage): void {
  if (!isRecord(entry)) return;

  into.utilizationPercent = highest(
    into.utilizationPercent,
    highestUsagePercent(entry, USAGE_PERCENT_KEYS),
  );

  const regainMinutes = finitePositive(entry["estimated_time_to_regain_access"]);
  if (regainMinutes !== null && regainMinutes > 0) {
    into.estimatedRegainMs = highest(
      into.estimatedRegainMs,
      regainMinutes * 60_000,
    );
  }

  const resetSeconds = finitePositive(entry["reset_time_duration"]);
  if (resetSeconds !== null && resetSeconds > 0) {
    into.estimatedRegainMs = highest(
      into.estimatedRegainMs,
      resetSeconds * 1_000,
    );
  }
}

function readAppUsageEntry(entry: unknown, into: QuotaUsage): void {
  if (!isRecord(entry)) return;
  const candidate = highestUsagePercent(entry, APP_USAGE_PERCENT_KEYS);
  if (candidate === null) return;
  into.appUtilizationPercent = highest(
    into.appUtilizationPercent ?? null,
    candidate,
  );
}

/**
 * Lê os headers de uso de uma resposta da Graph API. Sempre a leitura mais
 * PESSIMISTA: o maior percentual entre contas, tipos de uso e headers, porque
 * qualquer um deles estourando gera erro — e erro é o que não se pode gerar.
 */
export function readQuotaUsage(
  headers: Headers | null | undefined,
): QuotaUsage {
  if (!headers) return { ...UNKNOWN_QUOTA_USAGE };

  const usage: QuotaUsage = { ...UNKNOWN_QUOTA_USAGE };

  // `{"<account-id>": [{type, call_count, …}]}` — uma lista por conta.
  const businessUsage = parseJsonHeader(headers, "x-business-use-case-usage");
  if (isRecord(businessUsage)) {
    for (const entries of Object.values(businessUsage)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) readUsageEntry(entry, usage);
    }
  }

  const insightsUsage = parseJsonHeader(headers, "x-fb-ads-insights-throttle");
  readUsageEntry(insightsUsage, usage);
  // Este header mistura percentuais da conta e do app; só `app_id_util_pct`
  // alimenta o breaker global.
  if (isRecord(insightsUsage)) {
    const appPercent = finitePositive(insightsUsage["app_id_util_pct"]);
    if (appPercent !== null) usage.appUtilizationPercent = appPercent;
  }

  readUsageEntry(parseJsonHeader(headers, "x-ad-account-usage"), usage);

  const appUsage = parseJsonHeader(headers, "x-app-usage");
  readUsageEntry(appUsage, usage);
  readAppUsageEntry(appUsage, usage);

  return usage;
}

/** A pior das duas leituras — é ela que decide se a conta continua. */
export function mergeQuotaUsage(a: QuotaUsage, b: QuotaUsage): QuotaUsage {
  const merged: QuotaUsage = {
    utilizationPercent: highest(a.utilizationPercent, b.utilizationPercent),
    estimatedRegainMs: highest(a.estimatedRegainMs, b.estimatedRegainMs),
  };
  const appUtilizationPercent = highest(
    a.appUtilizationPercent ?? null,
    b.appUtilizationPercent ?? null,
  );
  if (appUtilizationPercent !== null) {
    merged.appUtilizationPercent = appUtilizationPercent;
  }
  return merged;
}

/**
 * Hora de parar esta conta? Cota desconhecida NÃO interrompe: o silêncio da
 * Meta não é sinal de aperto, e parar por falta de informação deixaria buraco na
 * série todo dia.
 */
export function shouldStopForQuota(
  usage: QuotaUsage,
  thresholdPercent: number = QUOTA_STOP_THRESHOLD_PERCENT,
): boolean {
  if (usage.estimatedRegainMs !== null && usage.estimatedRegainMs > 0) {
    return true;
  }
  return (
    usage.utilizationPercent !== null &&
    usage.utilizationPercent >= thresholdPercent
  );
}

/**
 * Hora de interromper a run inteira? Só um percentual explicitamente global
 * conta. BUC e `X-Ad-Account-Usage` continuam limitando apenas a conta atual.
 */
export function shouldStopForAppQuota(
  usage: QuotaUsage,
  thresholdPercent: number = QUOTA_STOP_THRESHOLD_PERCENT,
): boolean {
  return (
    usage.appUtilizationPercent !== undefined &&
    usage.appUtilizationPercent !== null &&
    usage.appUtilizationPercent >= thresholdPercent
  );
}
