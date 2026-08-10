/**
 * Quick staging smoke for proactivity alerts + remarketing catalog.
 * Usage: APP_ENV=staging bun scripts/with-env.ts bun scripts/smoke-proactivity-staging.ts
 */
import { getConsultantPlaybookAlertConfig } from "@/lib/db/proactivity-alert-queries";
import { listProactivityAlerts } from "@/lib/db/proactivity-alert-queries";
import {
  isMetaFakeScenarioEnvAllowed,
  parseMetaFakeScenarioUserIds,
} from "@/lib/meta-fake/config";
import {
  buildFullDemoCampaignMetrics,
  FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
} from "@/lib/meta-fake/full-demo-campaigns";
import {
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_NO_DELIVERY,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_STALLED,
} from "@/lib/playbook-insights/constants";
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

const allowlist = [...parseMetaFakeScenarioUserIds()];
console.log(
  "fake meta env allowed:",
  isMetaFakeScenarioEnvAllowed(),
  "| allowlist size:",
  allowlist.length,
  allowlist.length > 0 ? `| ids: ${allowlist.join(", ")}` : "",
);

const now = new Date();
const fullDemo = evaluatePlaybookInsights({
  accountId: FULL_DEMO_PLAYBOOK_ACCOUNT_ID,
  campaigns: buildFullDemoCampaignMetrics(now),
  now,
  config: {
    enabledRuleIds: cfg.enabledPlaybookRuleIds,
    thresholdsByRuleId: cfg.thresholdsByPlaybookRuleId,
  },
});
const expectedConsultantRules = [
  PLAYBOOK_RULE_ROAS_TRIGGER,
  PLAYBOOK_RULE_ROAS_SCALE,
  PLAYBOOK_RULE_CPA_ALERT,
  PLAYBOOK_RULE_STALLED,
  PLAYBOOK_RULE_NO_DELIVERY,
];
const fullDemoIds = new Set(fullDemo.candidates.map((c) => c.ruleId));
const missing = expectedConsultantRules.filter(
  (id) => cfg.enabledPlaybookRuleIds.has(id) && !fullDemoIds.has(id),
);
console.log(
  "full_demo with DB thresholds →",
  [...fullDemoIds].join(", ") || "(none)",
  missing.length === 0
    ? "| coverage: ok for enabled rules"
    : `| missing enabled rules: ${missing.join(", ")}`,
);

process.exit(0);
