import "server-only";

import { Resend } from "resend";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  expertProfile,
  productOrder,
  productPayment,
  productRefundBalanceCase,
  user,
} from "@/lib/db/schema";

function formatAmount(amountCentavos: number | null) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((amountCentavos ?? 0) / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function recipientsForCase(row: {
  case: { responsible: "expert" | "automatize"; expertId: string | null };
  expertUser: { email: string; name: string | null } | null;
}) {
  return [...new Set([
    ...(row.case.responsible === "expert" && row.expertUser?.email ? [row.expertUser.email] : []),
    ...(process.env.PRODUCT_REFUND_ALERT_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean),
  ])];
}

/** Backoffice can send the first alert immediately; the frontend cron retries
 * delivery if Resend or the recipient list is temporarily unavailable. */
export async function notifyProductRefundBalanceCase(caseId: string) {
  const [row] = await db
    .select({ case: productRefundBalanceCase, payment: productPayment, order: productOrder, expertUser: user })
    .from(productRefundBalanceCase)
    .innerJoin(productPayment, eq(productPayment.id, productRefundBalanceCase.paymentId))
    .innerJoin(productOrder, eq(productOrder.id, productPayment.orderId))
    .leftJoin(expertProfile, eq(expertProfile.id, productRefundBalanceCase.expertId))
    .leftJoin(user, eq(user.id, expertProfile.userId))
    .where(eq(productRefundBalanceCase.id, caseId))
    .limit(1);
  if (!row || row.case.noticeSentAt) return { sent: false, reason: "already_notified" as const };
  const recipients = recipientsForCase(row);
  if (!recipients.length) return { sent: false, reason: "missing_recipients" as const };
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false, reason: "missing_resend_key" as const };
  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL ?? process.env.BACKOFFICE_EMAIL_FROM ?? "Automatize Marketing <onboarding@resend.dev>";
  const firstFailedAt = formatDate(row.case.firstFailedAt);
  const dueAt = formatDate(row.case.regularizationDueAt);
  const html = `<p>O Mercado Pago confirmou saldo insuficiente para o reembolso integral de <strong>${escapeHtml(row.order.productTitleSnapshot)}</strong>.</p><p><strong>Valor:</strong> ${escapeHtml(formatAmount(row.payment.grossAmountCentavos))}<br/><strong>Pagamento:</strong> ${escapeHtml(row.payment.providerPaymentId ?? row.payment.id)}<br/><strong>Primeira falha:</strong> ${escapeHtml(firstFailedAt)}<br/><strong>Prazo:</strong> ${escapeHtml(dueAt)}<br/><strong>Tentativas:</strong> ${row.case.attemptCount}</p><p>${row.case.responsible === "expert" ? "A conta histórica do Expert é responsável; após 24 horas, novas vendas poderão ser pausadas." : "A equipe Automatize é responsável pela regularização."}</p><p>O caso só é encerrado após confirmação integral do provedor.</p>`;
  for (const [index, to] of recipients.entries()) {
    const { error } = await resend.emails.send({ from, to: [to], subject: "Ação necessária para concluir um reembolso", html }, { idempotencyKey: `product-refund-balance-notice/${caseId}/${index}` });
    if (error) return { sent: false, reason: "delivery_failed" as const };
  }
  const now = new Date();
  await db.update(productRefundBalanceCase).set({ noticeSentAt: now, updatedAt: now }).where(and(eq(productRefundBalanceCase.id, caseId), isNull(productRefundBalanceCase.noticeSentAt)));
  return { sent: true as const, recipients };
}
