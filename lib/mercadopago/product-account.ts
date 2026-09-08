import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { productPayment } from "@/lib/db/schema";

/**
 * Descobre em qual conta do Mercado Pago vivem as cobranças de infoproduto.
 *
 * Escolher token por nome de variável não funciona, e isso foi medido, não
 * suposto: em 08/09/2026 o `MERCADOPAGO_ACCESS_TOKEN` de PRODUÇÃO do backoffice
 * respondia 404 para três cobranças de produto reais criadas pelo app — token
 * válido, conta errada. Uma cobrança criada ali seria invisível para o webhook
 * do app: o cliente pagaria e o produto nunca liberaria. E a ordem "certa" das
 * variáveis muda entre backoffice e app, e entre produção e preview.
 *
 * Então em vez de adivinhar, pergunta-se ao Mercado Pago. A prova de posse é
 * uma cobrança que o app JÁ processou: só `processProductPayment` escreve
 * `raw_status`, e ele só escreve depois de ler o pagamento com o token do app.
 * Um pagamento com `raw_status` preenchido está, por construção, na conta certa
 * — então o token que consegue lê-lo é o token certo.
 */

const CANDIDATE_ENV_VARS = [
  // Escape hatch explícito: se alguém configurar isto, vence tudo.
  "MERCADOPAGO_PRODUCT_ACCESS_TOKEN",
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_SUBSCRIPTION_ACCESS_TOKEN",
  "MERCADO_PAGO_ACCESS_TOKEN",
] as const;

export class ProductPixAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductPixAccountError";
  }
}

/** Resolvido uma vez por processo: a conta não muda em tempo de execução. */
let cached: string | null = null;

function candidateTokens(): { name: string; token: string }[] {
  const seen = new Set<string>();
  const tokens: { name: string; token: string }[] = [];
  for (const name of CANDIDATE_ENV_VARS) {
    const token = process.env[name]?.trim();
    // `[SENSITIVE]` é o que o `vercel env pull` grava no lugar de variável
    // marcada como sensível — já apareceu em arquivo local e não é credencial.
    if (!token || token === "[SENSITIVE]" || seen.has(token)) continue;
    seen.add(token);
    tokens.push({ name, token });
  }
  return tokens;
}

async function tokenCanRead(token: string, paymentId: string): Promise<boolean> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  return response.ok;
}

/**
 * Pagamento de referência: uma cobrança de produto que o webhook do app já
 * processou. `raw_status` só é escrito por lá.
 */
async function findReferencePaymentId(): Promise<string | null> {
  const [row] = await db
    .select({ id: productPayment.providerPaymentId })
    .from(productPayment)
    .where(
      and(
        eq(productPayment.provider, "mercadopago"),
        isNotNull(productPayment.providerPaymentId),
        isNotNull(productPayment.rawStatus),
      ),
    )
    .orderBy(desc(productPayment.updatedAt))
    .limit(1);

  return row?.id ?? null;
}

export async function resolveProductPixAccessToken(): Promise<string> {
  if (cached) return cached;

  const explicit = process.env.MERCADOPAGO_PRODUCT_ACCESS_TOKEN?.trim();
  if (explicit && explicit !== "[SENSITIVE]") {
    cached = explicit;
    return cached;
  }

  const candidates = candidateTokens();
  if (candidates.length === 0) {
    throw new ProductPixAccountError(
      "Nenhum token do Mercado Pago configurado neste ambiente.",
    );
  }

  const referencePaymentId = await findReferencePaymentId();
  if (!referencePaymentId) {
    // Sem cobrança de produto já processada, não há como provar a conta. Um
    // palpite aqui custa o dinheiro de um cliente; pedir configuração custa um
    // deploy.
    throw new ProductPixAccountError(
      "Não há cobrança de produto já confirmada neste banco para identificar a conta do Mercado Pago. " +
        "Configure MERCADOPAGO_PRODUCT_ACCESS_TOKEN com o mesmo token que o app usa para infoproduto.",
    );
  }

  for (const candidate of candidates) {
    if (await tokenCanRead(candidate.token, referencePaymentId)) {
      cached = candidate.token;
      return cached;
    }
  }

  throw new ProductPixAccountError(
    `Nenhum dos tokens configurados (${candidates.map((c) => c.name).join(", ")}) ` +
      `enxerga a cobrança de produto ${referencePaymentId}, então nenhum está na conta ` +
      "que o app usa para infoproduto. Configure MERCADOPAGO_PRODUCT_ACCESS_TOKEN.",
  );
}

/** Só para teste: o cache é por processo e atrapalharia asserções. */
export function resetProductPixAccessTokenCache() {
  cached = null;
}
