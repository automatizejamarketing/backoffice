import { createHash } from "node:crypto";

/**
 * Cache de LEITURAS da Graph API — a mitigação de rate limit da Meta no
 * backoffice (irmã da versão do automatize-frontend, sem a camada Redis:
 * este projeto não tem cliente Redis, então é L1 em memória por instância).
 *
 * O que ele dá às leituras quentes do painel /marketing:
 *  - TTL curto por chave (a mesma conta aberta por dois admins, ou o mesmo
 *    painel remontado, deixa de repetir a chamada);
 *  - dedupe de chamadas concorrentes idênticas;
 *  - serve-stale APENAS quando a Meta responde rate limit — dado de alguns
 *    minutos atrás é estritamente melhor que repassar o 429/500 ao admin.
 *
 * O que NUNCA entra aqui: mutações, e leituras cujo frescor pós-mutação é
 * visível na UI (listas de campanhas/conjuntos/anúncios).
 */

type CacheEntry<T> = {
  value: T;
  /** Até quando a entrada é fresca (servida sem consultar a Meta). */
  freshUntil: number;
  /** Até quando pode ser servida como stale num throttle. */
  staleUntil: number;
};

/** Teto da L1 — evita crescimento sem fim numa instância longeva. */
const MEMORY_MAX_ENTRIES = 1000;

/**
 * TTL compartilhado pelas rotas de insights (campanha/conjunto/anúncio).
 * Espelha o `INSIGHTS_STALE_TIME` do cliente (marketing-queries.ts): o próprio
 * front do backoffice já considera esses números frescos por 5 minutos.
 */
export const INSIGHTS_CACHE_TTL_MS = 5 * 60 * 1000;

const memory = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Identidade de token para compor chaves sem jamais gravar o token em si.
 * Reconectou (token novo) → chave nova → nada vaza entre conexões.
 */
export function tokenCacheId(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
}

function readMemory<T>(key: string, now: number): CacheEntry<T> | null {
  const entry = memory.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (entry.staleUntil <= now) {
    memory.delete(key);
    return null;
  }
  return entry;
}

function writeMemory<T>(key: string, entry: CacheEntry<T>): void {
  // Reinsere para manter a ordem de inserção ≈ ordem de expiração e descartar
  // o mais antigo quando o teto é atingido.
  memory.delete(key);
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, entry);
}

/** Erros de throttle da Meta autorizam servir a janela stale. */
function isMetaRateLimitError(error: unknown): boolean {
  const errorReturn = (
    error as {
      errorReturn?: { statusCode?: number; data?: { code?: number } };
    }
  )?.errorReturn;
  const code = errorReturn?.data?.code;
  const RATE_LIMIT_CODES = [4, 17, 32, 341, 368, 613, 80000, 80003, 80004, 80014, 1404078, 2859015];
  return (
    (typeof code === "number" && RATE_LIMIT_CODES.includes(code)) ||
    errorReturn?.statusCode === 429
  );
}

export type CachedMetaReadArgs<T> = {
  /**
   * Chave completa da entrada. DEVE incluir a identidade do token
   * ({@link tokenCacheId}) ou do usuário — nunca compartilhe entre conexões.
   */
  key: string;
  /** Janela de frescor, em ms. */
  ttlMs: number;
  /**
   * Janela adicional em que a entrada pode ser servida SOB THROTTLE, em ms.
   * Zero desliga o serve-stale. Default: 6× o TTL.
   */
  staleMs?: number;
  /** A leitura real na Meta. Só roda em cache miss. */
  fetcher: () => Promise<T>;
};

/**
 * Executa uma leitura Meta com cache curto, dedupe de chamadas concorrentes e
 * serve-stale sob rate limit. Erros nunca são cacheados.
 */
export async function cachedMetaRead<T>(args: CachedMetaReadArgs<T>): Promise<T> {
  const { key, ttlMs, fetcher } = args;
  const staleMs = args.staleMs ?? ttlMs * 6;
  const now = Date.now();

  const fromMemory = readMemory<T>(key, now);
  if (fromMemory && fromMemory.freshUntil > now) {
    return fromMemory.value;
  }

  // Requests concorrentes pela mesma chave compartilham um único fetch.
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) {
    return pending;
  }

  const task = (async (): Promise<T> => {
    try {
      const value = await fetcher();
      const entry: CacheEntry<T> = {
        value,
        freshUntil: Date.now() + ttlMs,
        staleUntil: Date.now() + ttlMs + staleMs,
      };
      writeMemory(key, entry);
      return value;
    } catch (error) {
      if (fromMemory && isMetaRateLimitError(error)) {
        console.warn(
          `[meta-read-cache] throttle da Meta; servindo stale para ${key.slice(0, 60)}`,
        );
        return fromMemory.value;
      }
      throw error;
    }
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/** Só para testes: limpa L1 e dedupe. */
export function resetMetaReadCacheForTests(): void {
  memory.clear();
  inflight.clear();
}
