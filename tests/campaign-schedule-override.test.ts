import assert from "node:assert/strict";
import test from "node:test";

import {
  describeScheduleOverride,
  scheduleOverrideFromRequest,
  validateCampaignScheduleBlocks,
} from "@/lib/meta-business/campaign-schedule";

test("backoffice: override do duplicar com novo horário", () => {
  assert.deepEqual(scheduleOverrideFromRequest({}), { ok: true });
  assert.deepEqual(
    scheduleOverrideFromRequest({ deliveryMode: "specific_hours", scheduleBlocks: [{ days: [2], startMinute: 1110, endMinute: 1410 }] }),
    { ok: true, override: { mode: "specific_hours", blocks: [{ days: [2], startMinute: 1080, endMinute: 1440 }] } },
  );
  assert.equal(scheduleOverrideFromRequest({ deliveryMode: "specific_hours", scheduleBlocks: [] }).ok, false);
  assert.equal(validateCampaignScheduleBlocks("all_day", undefined), null);
});

test("backoffice: texto da auditoria", () => {
  assert.equal(describeScheduleOverride({ mode: "all_day" }), "novo horário: o dia todo");
  assert.equal(
    describeScheduleOverride({ mode: "specific_hours", blocks: [{ days: [1, 2], startMinute: 1080, endMinute: 1380 }] }),
    "novo horário: dias 1,2 18:00–23:00",
  );
});
