import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { handleAgencyStripeEvent } from "@/lib/agency/plan";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Webhook do Stripe só para o Plano da Agência (ADR 0046), com segredo próprio. Assinaturas sem
 * `agency_id` nos metadados são ignoradas: as dos clientes são do webhook do frontend. Tudo aqui é
 * idempotente (relê a assinatura no Stripe; o "pago até" só avança), então reentrega não faz mal.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_AGENCY_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: "Stripe não configurado." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sem assinatura." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 400 });
  }

  try {
    await handleAgencyStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    // 500 faz o Stripe reenviar.
    console.error("[agency-webhook]", event.type, event.id, error);
    return NextResponse.json({ error: "Falha ao processar." }, { status: 500 });
  }
}
