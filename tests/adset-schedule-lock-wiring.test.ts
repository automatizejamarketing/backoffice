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

test("rota de edição do backoffice trava horário em CBO não editável e, na programada, manda só a grade", () => {
  const route = readFileSync(ROUTE, "utf8");
  const lock = route.indexOf("if (hasDeliveryScheduleChange && usesCBO && !cboScheduleEdit)");
  const editable = route.indexOf("if (cboScheduleEdit) {");
  const legacyPacing = route.indexOf("updateParams.pacing_type");
  assert.ok(lock > 0, "a trava continua para CBO não editável");
  assert.ok(editable > lock, "o ramo editável vem depois da trava");
  assert.ok(legacyPacing > editable, "pacing_type só no ramo antigo (ABO)");
  const editableBranch = route.slice(editable, route.indexOf("} else {", editable));
  assert.doesNotMatch(editableBranch, /pacing_type|lifetime_budget|end_time/);
  assert.match(route, /fields=id,daily_budget,lifetime_budget,pacing_type,bid_strategy/);
  assert.match(route, /scheduleLockRouteBody\(\)/);
});

test("o corpo da trava usa o código compartilhado", () => {
  assert.equal(scheduleLockRouteBody().error, SCHEDULE_LOCKED_UNDER_CBO);
});

test("sob CBO programada, horário + datas na mesma gravação é recusado antes de qualquer escrita", () => {
  const route = readFileSync(ROUTE, "utf8");
  const lock = route.indexOf("if (hasDeliveryScheduleChange && usesCBO && !cboScheduleEdit)");
  const together = route.indexOf("scheduleAndDatesChangedTogether({");
  const refusal = route.indexOf("scheduleWithDatesRouteBody()");
  const firstWrite = route.indexOf('method: "POST"');
  assert.ok(together > lock, "a checagem vem depois da trava");
  assert.ok(refusal > together, "recusa com o corpo compartilhado");
  assert.ok(firstWrite > refusal, "antes de qualquer POST");
  assert.match(route.slice(lock, refusal), /cboScheduleEdit &&/);
});
