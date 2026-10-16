import { getConsultantAccountAlertConfig } from "@/lib/db/proactivity-alert-queries";
import { deliverAccountAlertsToSlack } from "@/lib/proactivity/slack-delivery";
import {
  completeAccountAlertsRun,
  createAccountAlertsRun,
  failAccountAlertsRun,
  persistAccountAlertsForUser,
  type CreatedAccountAlert,
} from "./persist";
import { evaluateAccountAlerts } from "./evaluate";
import { loadAccountAlertSubjects } from "./load-subjects";

export async function runAccountAlertsBatch(args: {
  triggeredBy: "manual" | "cron";
  userId?: string | null;
}): Promise<{
  runId: string;
  evaluated: number;
  insightsCreated: number;
  slackSent: number;
  errorCount: number;
}> {
  const runId = await createAccountAlertsRun({ triggeredBy: args.triggeredBy });

  try {
    const config = await getConsultantAccountAlertConfig();
    const subjects = await loadAccountAlertSubjects();
    const selected = args.userId
      ? subjects.filter((subject) => subject.userId === args.userId)
      : subjects;

    let insightsCreated = 0;
    let errorCount = 0;
    const created: CreatedAccountAlert[] = [];

    for (const subject of selected) {
      try {
        const candidates = evaluateAccountAlerts({
          subject,
          thresholds: config.thresholds,
          enabledRuleIds: config.enabledRuleIds,
        });
        const inserted = await persistAccountAlertsForUser({
          runId,
          userId: subject.userId,
          clientName: subject.clientName,
          candidates,
        });
        insightsCreated += inserted.length;
        created.push(...inserted);
      } catch (error) {
        errorCount += 1;
        console.error("[account-alerts] user failed", {
          userId: subject.userId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    let slackSent = 0;
    try {
      const slack = await deliverAccountAlertsToSlack({
        created,
        deliverSlackByRuleId: config.deliverSlackByRuleId,
      });
      slackSent = slack.sent;
    } catch (error) {
      console.error("[account-alerts] slack delivery failed", error);
    }

    await completeAccountAlertsRun(runId, {
      usersEvaluated: selected.length,
      insightsCreated,
      errorCount,
    });

    return {
      runId,
      evaluated: selected.length,
      insightsCreated,
      slackSent,
      errorCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "account_alerts_failed";
    await failAccountAlertsRun(runId, message);
    throw error;
  }
}
