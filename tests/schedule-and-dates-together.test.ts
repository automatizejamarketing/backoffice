import assert from "node:assert/strict";
import test from "node:test";

import {
  SCHEDULE_WITH_DATES_UNDER_CBO,
  scheduleAndDatesChangedTogether,
  scheduleWithDatesRouteBody,
} from "@/lib/meta-business/schedule-dates-change";

const current = {
  startTime: "2026-09-23T19:38:15-0300",
  endTime: "2026-10-10T19:36:00-0300",
};

test("horário e datas mudando juntos: recusa", () => {
  assert.equal(
    scheduleAndDatesChangedTogether({
      hasDeliveryScheduleChange: true,
      startTime: new Date("2026-09-23T19:38:00-0300").toISOString(),
      endTime: new Date("2026-10-12T19:36:00-0300").toISOString(),
      current,
    }),
    true,
  );
});

test("só as datas: segue", () => {
  assert.equal(
    scheduleAndDatesChangedTogether({
      hasDeliveryScheduleChange: false,
      startTime: new Date("2026-09-24T10:00:00-0300").toISOString(),
      endTime: new Date("2026-10-12T19:36:00-0300").toISOString(),
      current,
    }),
    false,
  );
});

test("só a grade: segue (datas ausentes ou iguais às atuais, até o minuto)", () => {
  assert.equal(
    scheduleAndDatesChangedTogether({ hasDeliveryScheduleChange: true, current }),
    false,
  );
  assert.equal(
    scheduleAndDatesChangedTogether({
      hasDeliveryScheduleChange: true,
      startTime: new Date("2026-09-23T19:38:00-0300").toISOString(),
      endTime: new Date("2026-10-10T19:36:00-0300").toISOString(),
      current,
    }),
    false,
  );
});

test("corpo da recusa", () => {
  assert.deepEqual(scheduleWithDatesRouteBody(), {
    error: SCHEDULE_WITH_DATES_UNDER_CBO,
    message: "Sob orçamento de campanha, datas e horário não mudam na mesma gravação.",
    solution: "Salve primeiro as datas e depois o horário (ou o contrário), em duas gravações.",
  });
  assert.equal(SCHEDULE_WITH_DATES_UNDER_CBO, "SCHEDULE_WITH_DATES_UNDER_CBO");
});
