import "server-only";

import { Resend } from "resend";
import { formatInSaoPaulo } from "@/lib/backoffice/datetime-format";
import { getCommitmentMonths, PLAN_DEFINITIONS } from "@/lib/stripe/plans";
import { backofficeVindiPixEmailIdempotencyKey } from "./backoffice-pix";
import type { BackofficeVindiPixLinkView } from "./backoffice-pix";

const resend = new Resend(process.env.RESEND_API_KEY);

function getFromAddress(): string {
  const configured = process.env.RESEND_FROM_EMAIL;
  if (configured) return configured;

  if (process.env.NODE_ENV === "development") {
    return "Automatize Marketing <onboarding@resend.dev>";
  }

  throw new Error("RESEND_FROM_EMAIL is not configured");
}

export async function sendBackofficeVindiPixLinkEmail({
  to,
  name,
  link,
}: {
  to: string;
  name: string;
  link: BackofficeVindiPixLinkView;
}) {
  const plan = PLAN_DEFINITIONS[link.planType];
  const months = getCommitmentMonths(link.planType);
  const expiresAt = formatInSaoPaulo(link.expiresAt, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const { error } = await resend.emails.send(
    {
      from: getFromAddress(),
      to: [to],
      subject: `Pix para renovar ${plan.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
          <p>Olá, ${name}.</p>
          <p>Segue o Pix para pagar o plano <strong>${plan.name}</strong>.</p>
          <p>Período contratado: ${months} ${months === 1 ? "mês" : "meses"}.</p>
          <p style="font-family:monospace;font-size:12px;word-break:break-all;background:#f4f4f5;padding:12px;border-radius:8px">${link.pixCopyPasteCode}</p>
          <p style="font-size:12px;color:#666">O Pix vence em ${expiresAt}.</p>
        </div>
      `,
      text: `Olá, ${name}. Pix para ${plan.name}:\n\n${link.pixCopyPasteCode}\n\nVálido até ${expiresAt}.`,
    },
    { idempotencyKey: backofficeVindiPixEmailIdempotencyKey(link.id) },
  );

  if (error) throw new Error(error.message);
}
