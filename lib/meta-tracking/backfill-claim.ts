/**
 * O claim por conta do backfill — a peça que o ticket 05 deixou anotada como
 * dívida ("não há claim entre invocações do backfill; se virar cron, o claim tem
 * de nascer junto") e que o ticket 10 paga, porque agora o backfill TEM um
 * segundo disparador: o workflow que nasce quando o cliente conecta a Meta.
 *
 * ## O problema
 *
 * Dois processos podem querer a mesma conta ao mesmo tempo: o workflow da
 * conexão e o dreno manual (`bun run tracking:backfill`) — ou dois passos do
 * mesmo workflow, se um deles demorar mais que o outro esperava. O upsert da
 * série diária é idempotente, então o custo de refazer uma fatia não é dado
 * errado: é COTA. E cota é o recurso escasso desta fundação (a licença Meta do
 * app é throttled por taxa de erro, e o coletor diário disputa a mesma cota por
 * conta). Refazer treze meses em paralelo é a maneira mais cara possível de
 * chegar ao mesmo resultado.
 *
 * ## A decisão
 *
 * O claim é um carimbo (`claimedAt`) dentro do progresso por conta que o run de
 * backfill já mantém no `summary` (§6 do plano; ver
 * `lib/db/meta-tracking-backfill-queries.ts` para o porquê de o progresso morar
 * ali e não numa tabela). Uma conta está tomada quando ALGUM OUTRO run de
 * backfill ainda `running` a carimbou há menos que o TTL.
 *
 * Duas propriedades importam:
 *
 * 1. **Expira sozinho.** O dono pode morrer sem soltar o claim — a plataforma
 *    mata a invocação no meio, e não há `finally` que sobreviva a isso. O TTL é
 *    o mesmo dos runs travados (10 min): passado esse tempo a conta volta a
 *    estar livre, exatamente como o run volta a `failed`.
 * 2. **É renovado a cada checkpoint.** Uma conta grande leva mais que o TTL para
 *    fechar, e o checkpoint por fatia já acontece — ele carimba de novo. Claim
 *    parado é claim de dono morto.
 *
 * Este módulo é só a DECISÃO. A tomada do claim precisa ser atômica e por isso
 * vive em SQL (`claimBackfillAccount`), com o mesmo predicado escrito em
 * Postgres — o teste aqui é o que fixa a semântica que aquele SQL espelha.
 */

/**
 * Quanto tempo um claim vale sem ser renovado.
 *
 * Igual ao `STUCK_RUN_TIMEOUT_MS` de `meta-tracking-collector-queries.ts`, e
 * pela mesma razão: um pouco acima do `maxDuration` de 300 s das rotas de cron,
 * para que o disparo seguinte recupere o anterior sem esperar meia hora. Se os
 * dois divergirem, o run vira `failed` enquanto o claim dele ainda bloqueia a
 * conta (ou o contrário) — mantenha-os juntos.
 */
export const BACKFILL_CLAIM_TTL_MS = 10 * 60 * 1000;

/** O carimbo de um run sobre uma conta. `claimedAt` nulo = nunca carimbou. */
export type BackfillAccountClaim = {
  runId: string;
  claimedAt: string | null;
};

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

/**
 * O `claimedAt` de um objeto de progresso vindo do `summary` do run.
 *
 * Tolerante de propósito: o jsonb é livre, progresso gravado antes deste ticket
 * não tem a chave, e um valor ilegível não pode virar um claim eterno que
 * ninguém consegue derrubar. Em qualquer dúvida, a conta está livre.
 */
export function parseBackfillClaimedAt(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const claimedAt = (value as { claimedAt?: unknown }).claimedAt;
  if (typeof claimedAt !== "string") return null;
  if (!ISO_INSTANT_PATTERN.test(claimedAt)) return null;
  if (Number.isNaN(Date.parse(claimedAt))) return null;
  return claimedAt;
}

/** O instante a partir do qual um carimbo ainda vale. */
export function backfillClaimCutoff(
  now: Date,
  ttlMs: number = BACKFILL_CLAIM_TTL_MS,
): Date {
  return new Date(now.getTime() - ttlMs);
}

/**
 * O carimbo ainda vale?
 *
 * Carimbo no futuro conta como vivo: relógio do Postgres adiantado em relação ao
 * da função não pode ser motivo para dois processos entrarem na mesma conta.
 */
export function isBackfillClaimLive(args: {
  claimedAt: string | null;
  now: Date;
  ttlMs?: number;
}): boolean {
  if (args.claimedAt === null) return false;
  const claimedAtMs = Date.parse(args.claimedAt);
  if (Number.isNaN(claimedAtMs)) return false;
  return claimedAtMs > backfillClaimCutoff(args.now, args.ttlMs).getTime();
}

/**
 * Outro run vivo está com esta conta?
 *
 * O próprio run nunca bloqueia a si mesmo: a retomada dentro da mesma invocação
 * relê o próprio carimbo, e tratá-lo como concorrente travaria o backfill contra
 * ele mesmo.
 */
export function isBackfillAccountClaimedByOther(args: {
  claims: readonly BackfillAccountClaim[];
  ownRunId: string;
  now: Date;
  ttlMs?: number;
}): boolean {
  return args.claims.some(
    (claim) =>
      claim.runId !== args.ownRunId &&
      isBackfillClaimLive({
        claimedAt: claim.claimedAt,
        now: args.now,
        ttlMs: args.ttlMs,
      }),
  );
}
