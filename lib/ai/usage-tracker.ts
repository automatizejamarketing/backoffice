import "server-only";

import { db } from "../db/index";
import { aiUsageLog } from "../db/schema";

function extractGatewayCost(
  providerMetadata?: Record<string, unknown>
): string {
  if (!providerMetadata) return "0";

  const gateway = providerMetadata.gateway as
    | Record<string, unknown>
    | undefined;
  if (gateway?.cost) return String(gateway.cost);
  if (gateway?.marketCost) return String(gateway.marketCost);

  return "0";
}

function extractProvider(modelId: string): string {
  const parts = modelId.split("/");
  return parts.length >= 2 ? parts[0] : "unknown";
}

type AiUsage = {
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export async function trackAiUsage({
  userId,
  modelId,
  usage,
  providerMetadata,
  durationMs,
}: {
  userId: string;
  modelId: string;
  usage: AiUsage;
  providerMetadata?: Record<string, unknown>;
  durationMs?: number;
}) {
  const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
  const completionTokens = usage.completionTokens ?? usage.outputTokens ?? 0;
  const totalTokens =
    usage.totalTokens ?? promptTokens + completionTokens;

  const safePromptTokens = Number.isNaN(promptTokens)
    ? 0
    : Math.round(promptTokens);
  const safeCompletionTokens = Number.isNaN(completionTokens)
    ? 0
    : Math.round(completionTokens);
  const safeTotalTokens = Number.isNaN(totalTokens)
    ? safePromptTokens + safeCompletionTokens
    : Math.round(totalTokens);

  const cost = extractGatewayCost(providerMetadata);
  const provider = extractProvider(modelId);

  const [log] = await db
    .insert(aiUsageLog)
    .values({
      userId,
      modelId,
      provider,
      promptTokens: safePromptTokens,
      completionTokens: safeCompletionTokens,
      totalTokens: safeTotalTokens,
      cost,
      durationMs,
    })
    .returning();

  return log;
}
