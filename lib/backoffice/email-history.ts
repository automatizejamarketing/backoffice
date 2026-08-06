import "server-only";

import { Resend } from "resend";
import type { EmailHistoryItem } from "./email-history-model";

export type EmailHistoryResult =
  | { ok: true; emails: EmailHistoryItem[] }
  | { ok: false; emails: []; error: "not_configured" | "provider_error" };

export async function getEmailHistory(): Promise<EmailHistoryResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, emails: [], error: "not_configured" };
  }

  const { data, error } = await new Resend(apiKey).emails.list({ limit: 100 });
  if (error || !data) {
    console.error("[backoffice-email-history] Resend list failed:", {
      name: error?.name,
      message: error?.message,
    });
    return { ok: false, emails: [], error: "provider_error" };
  }

  return {
    ok: true,
    emails: data.data.map((email) => ({
      id: email.id,
      createdAt: email.created_at,
      from: email.from,
      to: email.to,
      subject: email.subject,
      status: email.last_event,
    })),
  };
}
