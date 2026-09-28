import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  SCHEDULE_LOCKED_UNDER_CBO,
  scheduleLockRouteBody,
} from "@/lib/meta-business/marketing/update/schedule-lock";

const ROUTE = join(
  process.cwd(),
  "app/api/meta-marketing/[accountId]/adsets/[adsetId]/edit/route.ts",
);

test("rota de edição do backoffice trava horário em CBO antes de montar pacing/adset_schedule", () => {
  const source = readFileSync(ROUTE, "utf8");
  const guard = source.indexOf("if (hasDeliveryScheduleChange && usesCBO)");
  const scheduleWrite = source.indexOf("updateParams.pacing_type");
  assert.ok(guard > 0, "a checagem da trava existe");
  assert.ok(scheduleWrite > guard, "a trava roda antes de montar os campos de horário");
  assert.match(source, /scheduleLockRouteBody\(\)/);
});

test("o corpo da trava usa o código compartilhado", () => {
  assert.equal(scheduleLockRouteBody().error, SCHEDULE_LOCKED_UNDER_CBO);
});
