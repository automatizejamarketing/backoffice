/**
 * Quick staging smoke for proactivity alerts + remarketing catalog.
 * Usage: APP_ENV=staging bun scripts/with-env.ts bun scripts/smoke-proactivity-staging.ts
 */
import { getConsultantPlaybookAlertConfig } from "@/lib/db/proactivity-alert-queries";
import { listProactivityAlerts } from "@/lib/db/proactivity-alert-queries";
import { PLAYBOOK_RULE_ROAS_TRIGGER } from "@/lib/playbook-insights/constants";
import { evaluatePlaybookInsights } from "@/lib/playbook-insights/evaluate";
import { REMARKETING_WHATSAPP_NUDGES } from "@/lib/proactivity/remarketing-nudge-catalog";

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid date: ${String(value)}`);
  }
  return parsed.toISOString();
}

const alerts = await listProactivityAlerts();
console.log(
  "DB alerts:",
  alerts.length,
  "| client:",
  alerts.filter((a) => a.audience === "client").length,
  "| consultant:",
  alerts.filter((a) => a.audience === "consultant").length,
);

for (const alert of alerts) {
  toIso(alert.createdAt);
  toIso(alert.updatedAt);
}
console.log("timestamp serialization: ok");

console.log(
  "remarketing readonly:",
  REMARKETING_WHATSAPP_NUDGES.map((n) => n.templateName).join(", "),
);

const cfg = await getConsultantPlaybookAlertConfig();
const evaluation = evaluatePlaybookInsights({
  accountId: "act_test",
  campaigns: [
    {
      id: "c1",
      name: "Low",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      updatedTime: null,
      spend: 100,
      purchaseRoas: 2,
      purchases: 5,
      purchaseValue: 200,
      impressions: 1000,
      cpa: 20,
    },
  ],
  config: {
    enabledRuleIds: cfg.enabledPlaybookRuleIds,
    thresholdsByRuleId: cfg.thresholdsByPlaybookRuleId,
  },
});
console.log(
  "playbook with DB config:",
  evaluation.candidates.map((c) => c.ruleId).join(", ") || "(none)",
);
console.log(
  "roas_trigger enabled:",
  cfg.enabledPlaybookRuleIds.has(PLAYBOOK_RULE_ROAS_TRIGGER),
);

const disabled = evaluatePlaybookInsights({
  accountId: "act_test",
  campaigns: evaluation.campaigns,
  config: { enabledRuleIds: new Set() },
});
console.log("all rules disabled → candidates:", disabled.candidates.length);

const tighter = evaluatePlaybookInsights({
  accountId: "act_test",
  campaigns: evaluation.campaigns,
  config: {
    enabledRuleIds: new Set([PLAYBOOK_RULE_ROAS_TRIGGER]),
    thresholdsByRuleId: new Map([
      [PLAYBOOK_RULE_ROAS_TRIGGER, { minSpend: 50, roasTrigger: 1.5 }],
    ]),
  },
});
console.log(
  "roasTrigger=1.5 should NOT fire on ROAS 2:",
  tighter.candidates.length === 0,
);

process.exit(0);
