import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryScheduleFromMetaAdSetSchedule,
  getDeliveryModeFromMetaAdSetSchedule,
} from "../lib/meta-business/campaign-schedule";
import { transformCampaign } from "../lib/meta-business/transformers";

test("grade de 24h x 7 é o dia todo, em 1 bloco ou em 7", () => {
  const sevenBlocks = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ days: [day], start_minute: 0, end_minute: 1440 }));
  assert.equal(getDeliveryModeFromMetaAdSetSchedule(sevenBlocks), "all_day");
  assert.deepEqual(deliveryScheduleFromMetaAdSetSchedule(sevenBlocks), { deliveryMode: "all_day", scheduleBlocks: [] });
});

test("transformCampaign expõe o pacing_type da campanha como lista", () => {
  const campaign = transformCampaign({ id: "c1", lifetime_budget: "30000", pacing_type: "day_parting" } as never);
  assert.deepEqual(campaign.pacingType, ["day_parting"]);
});
