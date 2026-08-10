import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  proactivityAlertDelivery,
  user,
  userMarketingConsultant,
  backofficeUser,
} from "@/lib/db/schema";
import type { NewlyCreatedPlaybookInsight } from "@/lib/db/playbook-insights-queries";
import {
  isMetaFakeScenarioUser,
  META_FAKE_SKIP_REASON,
} from "@/lib/meta-fake/config";

function getBackofficeBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "https://backoffice.automatizemarketing.com"
  ).replace(/\/+$/, "");
}

function sanitizeErrorMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function claimDelivery(args: {
  userId: string;
  alertId: string;
  dedupKey: string;
}): Promise<boolean> {
  const inserted = await db
    .insert(proactivityAlertDelivery)
    .values({
      userId: args.userId,
      alertId: args.alertId,
      channel: "slack",
      dedupKey: args.dedupKey,
      status: "scheduled",
    })
    .onConflictDoNothing()
    .returning({ id: proactivityAlertDelivery.id });

  if (inserted.length > 0) return true;

  // Reclaim failed provider errors only
  const reclaimed = await db
    .update(proactivityAlertDelivery)
    .set({
      status: "scheduled",
      reasonCode: null,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(proactivityAlertDelivery.alertId, args.alertId),
        eq(proactivityAlertDelivery.channel, "slack"),
        eq(proactivityAlertDelivery.dedupKey, args.dedupKey),
        eq(proactivityAlertDelivery.status, "failed"),
        eq(proactivityAlertDelivery.reasonCode, "provider_error"),
      ),
    )
    .returning({ id: proactivityAlertDelivery.id });

  return reclaimed.length > 0;
}

async function markDelivery(args: {
  alertId: string;
  dedupKey: string;
  status: "sending" | "sent" | "skipped" | "failed";
  reasonCode?: string | null;
  errorMessage?: string | null;
  providerMessageId?: string | null;
}) {
  await db
    .update(proactivityAlertDelivery)
    .set({
      status: args.status,
      reasonCode: args.reasonCode ?? null,
      errorMessage: sanitizeErrorMessage(args.errorMessage),
      providerMessageId: args.providerMessageId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(proactivityAlertDelivery.alertId, args.alertId),
        eq(proactivityAlertDelivery.channel, "slack"),
        eq(proactivityAlertDelivery.dedupKey, args.dedupKey),
      ),
    );
}

async function resolveConsultantLabel(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      email: backofficeUser.email,
      name: backofficeUser.name,
    })
    .from(userMarketingConsultant)
    .innerJoin(
      backofficeUser,
      eq(userMarketingConsultant.consultantId, backofficeUser.id),
    )
    .where(eq(userMarketingConsultant.userId, userId))
    .limit(1);

  if (!row) return null;
  return row.name?.trim() || row.email;
}

async function resolveClientLabel(userId: string): Promise<string> {
  const [row] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return userId;
  return row.name?.trim() || row.email;
}

export async function postSlackWebhook(text: string): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = process.env.SLACK_PROACTIVITY_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return { ok: false, error: "slack_not_configured" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        error: `Slack webhook failed (${response.status}): ${body.slice(0, 200)}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "slack_send_failed",
    };
  }
}

/**
 * Deliver newly created consultant playbook insights to Slack when configured.
 */
export async function deliverPlaybookInsightsToSlack(args: {
  userId: string;
  createdInsights: NewlyCreatedPlaybookInsight[];
  deliverSlackByPlaybookRuleId: Map<
    string,
    { alertId: string; enabled: boolean }
  >;
}): Promise<{ attempted: number; sent: number; skipped: number; failed: number }> {
  let attempted = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  if (args.createdInsights.length === 0) {
    return { attempted, sent, skipped, failed };
  }

  const fakeScenarioUser = isMetaFakeScenarioUser(args.userId);
  const clientLabel = await resolveClientLabel(args.userId);
  const consultantLabel = await resolveConsultantLabel(args.userId);
  const deepLink = `${getBackofficeBaseUrl()}/users/${args.userId}?tab=marketing`;

  for (const insight of args.createdInsights) {
    const channelConfig = args.deliverSlackByPlaybookRuleId.get(insight.ruleId);
    if (!channelConfig?.enabled) continue;

    const dedupKey = `${insight.ruleId}:${insight.entityId}`;
    const claimed = await claimDelivery({
      userId: args.userId,
      alertId: channelConfig.alertId,
      dedupKey,
    });
    if (!claimed) {
      skipped += 1;
      continue;
    }

    attempted += 1;
    await markDelivery({
      alertId: channelConfig.alertId,
      dedupKey,
      status: "sending",
    });

    if (fakeScenarioUser) {
      await markDelivery({
        alertId: channelConfig.alertId,
        dedupKey,
        status: "skipped",
        reasonCode: META_FAKE_SKIP_REASON,
      });
      skipped += 1;
      continue;
    }

    const consultantLine = consultantLabel
      ? `Consultor: ${consultantLabel}`
      : "Consultor: (não atribuído)";
    const text = [
      `*Playbook — ${insight.title}*`,
      `Cliente: ${clientLabel}`,
      consultantLine,
      insight.entityName ? `Campanha: ${insight.entityName}` : null,
      insight.evidence,
      `<${deepLink}|Abrir no backoffice>`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await postSlackWebhook(text);
    if (!result.ok) {
      const reason =
        result.error === "slack_not_configured"
          ? "slack_not_configured"
          : "provider_error";
      await markDelivery({
        alertId: channelConfig.alertId,
        dedupKey,
        status: reason === "slack_not_configured" ? "skipped" : "failed",
        reasonCode: reason,
        errorMessage: result.error,
      });
      if (reason === "slack_not_configured") skipped += 1;
      else failed += 1;
      continue;
    }

    await markDelivery({
      alertId: channelConfig.alertId,
      dedupKey,
      status: "sent",
    });
    sent += 1;
  }

  return { attempted, sent, skipped, failed };
}
