import { Resend } from "resend";
import { BACKOFFICE_MAGIC_LINK_TTL_MINUTES } from "@/lib/auth/magic-link";

type SendBackofficeMagicLinkEmailInput = {
  email: string;
  magicLink: string;
};

type SendBackofficeMagicLinkEmailResult = {
  sent: boolean;
};

function getBackofficeEmailFrom(): string {
  return (
    process.env.BACKOFFICE_EMAIL_FROM ??
    process.env.EMAIL_FROM ??
    "AutomatizeJa Backoffice <onboarding@resend.dev>"
  );
}

export async function sendBackofficeMagicLinkEmail({
  email,
  magicLink,
}: SendBackofficeMagicLinkEmailInput): Promise<SendBackofficeMagicLinkEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    if (process.env.NODE_ENV !== "production") {
      return { sent: false };
    }
    throw new Error("Missing RESEND_API_KEY");
  }

  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: getBackofficeEmailFrom(),
    to: email,
    subject: "Link de acesso - Backoffice AutomatizeJa",
    html: `
      <p>Clique no link abaixo para acessar o backoffice:</p>
      <p><a href="${magicLink}">${magicLink}</a></p>
      <p>Este link expira em ${BACKOFFICE_MAGIC_LINK_TTL_MINUTES} minutos.</p>
      <p>Se voce nao solicitou este acesso, ignore este e-mail.</p>
    `,
  });

  return { sent: true };
}
