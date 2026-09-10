/**
 * Prova ponta a ponta do Pix de recuperação, contra a staging.
 *
 * O que precisa ficar provado, e não apenas parecer certo:
 *  1. a cobrança nasce com o `metadata` que o webhook do app exige;
 *  2. o valor cobrado é a soma do grupo (senão vira `amount_mismatch` lá);
 *  3. o grupo volta para `pending`, que é o estado em que a aprovação opera;
 *  4. a linha de pagamento aponta para a cobrança NOVA, sem resíduo da vencida.
 *
 * Restaura o pedido ao estado original no fim. A cobrança criada na MP fica —
 * ninguém vai pagá-la e ela vence em 24h.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { productOrder, productPayment } from "@/lib/db/schema";
import { listRecoveryPixOrders } from "@/lib/db/product-queries";
import { fetchProductPixCharge } from "@/lib/mercadopago/product-pix";
import { generateRecoveryPix } from "@/lib/products/recovery-pix-service";
import { readRecoveryPixStamp } from "@/lib/products/recovery-pix-policy";
import { resolveProductPixAccessToken } from "@/lib/mercadopago/product-account";

const ADMIN = "verificacao@automatize.local";
let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? "  OK  " : " FALHA"} ${label}`);
  if (!condition) {
    failures += 1;
    if (detail !== undefined) console.log("        →", detail);
  }
}

async function main() {
  const queue = await listRecoveryPixOrders();
  const target = queue.find((row) => row.status === "failed");
  if (!target) throw new Error("Staging não tem Pix vencido para testar.");

  console.log(`Pedido: ${target.id}`);
  console.log(`Produto: ${target.productTitle} · ${target.buyerEmail}`);
  console.log(`Valor: ${target.priceCentavos} centavos\n`);

  const [before] = await db
    .select()
    .from(productOrder)
    .where(eq(productOrder.id, target.id))
    .limit(1);
  const [paymentBefore] = await db
    .select()
    .from(productPayment)
    .where(eq(productPayment.orderId, target.id))
    .limit(1);
  if (!before) throw new Error("pedido sumiu");

  const result = await generateRecoveryPix({ orderId: target.id, adminEmail: ADMIN });
  if (!result.ok) {
    if (result.reason === "webhook_unreachable") {
      throw new Error(
        [
          "Recusado por falta de webhook alcançável — é a guarda funcionando, não um bug.",
          "Rode com FRONTEND_APP_URL apontando para o app:",
          "FRONTEND_APP_URL=https://<app> bun run products:verify-recovery-pix-staging",
        ].join(" "),
      );
    }
    throw new Error(`geração recusada: ${result.reason}`);
  }

  console.log("--- cobrança criada ---");
  check("copia-e-cola veio da MP", result.pixCopyPasteCode.startsWith("000201"));
  check(
    "valor = soma do grupo",
    result.amountCentavos === before.priceCentavos,
    { cobrado: result.amountCentavos, pedido: before.priceCentavos },
  );
  check("vence em ~24h", Math.abs(
    result.expiresAt.getTime() - Date.now() - 24 * 3600_000,
  ) < 60_000);

  console.log("\n--- estado do banco ---");
  const [orderAfter] = await db
    .select()
    .from(productOrder)
    .where(eq(productOrder.id, target.id))
    .limit(1);
  const [paymentAfter] = await db
    .select()
    .from(productPayment)
    .where(eq(productPayment.orderId, target.id))
    .limit(1);

  check("pedido reaberto para pending", orderAfter?.status === "pending", orderAfter?.status);
  check(
    "pagamento aponta para a cobrança NOVA",
    Boolean(paymentAfter?.providerPaymentId) &&
      paymentAfter?.providerPaymentId !== paymentBefore?.providerPaymentId,
    { antes: paymentBefore?.providerPaymentId, depois: paymentAfter?.providerPaymentId },
  );
  check("pagamento voltou a pending", paymentAfter?.status === "pending", paymentAfter?.status);
  check(
    "resíduo da cobrança vencida foi limpo",
    paymentAfter?.rawStatus === null && paymentAfter?.paymentMethodId === null,
    { rawStatus: paymentAfter?.rawStatus, method: paymentAfter?.paymentMethodId },
  );

  const stamp = readRecoveryPixStamp(orderAfter?.attribution);
  check("carimbo gravado com o admin", stamp?.adminEmail === ADMIN, stamp);
  check(
    "atribuição original preservada",
    Object.entries(before.attribution ?? {}).every(
      ([key, value]) => orderAfter?.attribution?.[key] === value,
    ),
    { antes: before.attribution, depois: orderAfter?.attribution },
  );

  console.log("\n--- contrato que o webhook do app valida ---");
  const raw = await fetchRawPayment(paymentAfter!.providerPaymentId!);
  // A asserção que faltava: a cobrança nova tem que estar na MESMA conta das
  // cobranças que o app já confirmou. Se não estiver, o webhook do app dá 404
  // nela e o cliente paga sem receber o produto.
  check("cobrança nasceu na conta que o app enxerga", raw !== null);
  const metadata = (raw?.metadata ?? {}) as Record<string, unknown>;
  check('payment_context = "digital_product"', metadata.payment_context === "digital_product", metadata.payment_context);
  check("product_order_id = o pedido", metadata.product_order_id === target.id, metadata.product_order_id);
  check(
    "amount_centavos inteiro e igual ao cobrado",
    Number.isInteger(metadata.amount_centavos) &&
      metadata.amount_centavos === result.amountCentavos,
    metadata.amount_centavos,
  );
  check("notification_url aponta para o webhook do app",
    typeof raw?.notification_url === "string" &&
      raw.notification_url.includes("/api/mercadopago/webhook"),
    raw?.notification_url);
  check("cobrança está viva na MP", raw?.status === "pending", raw?.status);

  console.log("\n--- reaproveitamento (não pode criar segunda cobrança) ---");
  const again = await generateRecoveryPix({ orderId: target.id, adminEmail: ADMIN });
  check("segunda chamada reaproveita", again.ok && again.reused === true, again);
  check(
    "mesmo código",
    again.ok && again.pixCopyPasteCode === result.pixCopyPasteCode,
  );
  const live = await fetchProductPixCharge(paymentAfter!.providerPaymentId!);
  check("continua uma cobrança só", live?.status === "pending");

  console.log("\n--- restaurando a staging ---");
  await db
    .update(productOrder)
    .set({ status: before.status, attribution: before.attribution, updatedAt: before.updatedAt })
    .where(eq(productOrder.id, target.id));
  if (paymentBefore) {
    await db
      .update(productPayment)
      .set({
        providerPaymentId: paymentBefore.providerPaymentId,
        status: paymentBefore.status,
        rawStatus: paymentBefore.rawStatus,
        paymentMethodId: paymentBefore.paymentMethodId,
        paymentTypeId: paymentBefore.paymentTypeId,
        updatedAt: paymentBefore.updatedAt,
      })
      .where(eq(productPayment.orderId, target.id));
  }
  const [restored] = await db
    .select({ status: productOrder.status })
    .from(productOrder)
    .where(inArray(productOrder.id, [target.id]))
    .limit(1);
  check("pedido restaurado", restored?.status === before.status, restored?.status);

  console.log(failures === 0 ? "\nTUDO VERDE" : `\n${failures} FALHA(S)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

async function fetchRawPayment(paymentId: string) {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    { headers: { Authorization: `Bearer ${await resolveProductPixAccessToken()}` } },
  );
  if (!response.ok) return null;
  return (await response.json()) as {
    status?: string;
    notification_url?: string;
    metadata?: Record<string, unknown>;
  };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
