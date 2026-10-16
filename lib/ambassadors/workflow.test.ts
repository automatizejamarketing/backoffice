import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  changeTask,
  newWorkflow,
  refreshWorkflow,
  nextCreditDate,
  todayInBrazil,
  type TaskChange,
  type AmbassadorWorkflow,
} from "./workflow";
const today = "2026-10-02";
function apply(
  state: AmbassadorWorkflow,
  key: TaskChange["key"],
  date: string,
  operation: TaskChange["operation"] = "complete",
  cycle = "initial",
) {
  return changeTask(
    state,
    { cycle, key, date, operation },
    today,
    "coproducer",
    true,
  );
}
function onboarding() {
  const state = apply(newWorkflow(), "formalization", "2026-09-20");
  return apply(state, "onboarding", "2026-09-21");
}
function published() {
  let state = apply(onboarding(), "feedback", "2026-09-28");
  state = apply(state, "publication_date", "2026-09-30", "schedule");
  state = apply(state, "publication_date", "2026-09-28");
  state = apply(state, "briefing", "2026-09-28");
  return apply(state, "publication", "2026-09-30");
}
test("real onboarding date, not entry date, anchors feedback; correction only recalculates pending", () => {
  let state = onboarding();
  assert.equal(state.initial.feedback?.dueOn, "2026-09-28");
  state = apply(state, "onboarding", "2026-09-22", "correct");
  assert.equal(state.initial.feedback?.dueOn, "2026-09-29");
  state = apply(state, "feedback", "2026-09-29");
  state = apply(state, "onboarding", "2026-09-21", "correct");
  assert.equal(state.initial.feedback?.completedOn, "2026-09-29");
  assert.equal(state.initial.feedback?.dueOn, "2026-09-29");
});
test("initial actual publication backdated into September creates October once and keeps overdue months", () => {
  const state = published();
  assert.deepEqual(Object.keys(state.months), ["2026-10"]);
  refreshWorkflow(state, "2026-12-01", true);
  refreshWorkflow(state, "2026-12-01", true);
  assert.deepEqual(Object.keys(state.months), [
    "2026-10",
    "2026-11",
    "2026-12",
  ]);
  assert.equal(state.months["2026-10"].publication_date?.dueOn, "2026-10-01");
  assert.equal(state.initial.publication?.completedOn, "2026-09-30");
});
test("independent tracks, shared formalization, reverse undo, archived coproduction", () => {
  let state = onboarding();
  state = apply(state, "brainstorm", "2026-09-22", "complete", "coproduction");
  assert.equal(state.coproduction.presentation?.dueOn, "2026-10-02");
  state = apply(state, "onboarding", today, "reopen");
  assert.equal(state.coproduction.brainstorm?.completedOn, "2026-09-22");
  assert.throws(
    () => apply(state, "formalization", today, "reopen"),
    /Desfaça/,
  );
  assert.throws(
    () =>
      changeTask(
        state,
        { cycle: "coproduction", key: "presentation", operation: "complete" },
        today,
        "ambassador",
        true,
      ),
    /arquivada/,
  );
});
test("schedule can precede dependencies; briefing reschedules pending only and publication cannot finish early", () => {
  let state = apply(
    newWorkflow(),
    "publication_date",
    "2026-10-05",
    "schedule",
  );
  assert.equal(state.initial.briefing?.dueOn, today);
  assert.throws(() => apply(state, "publication_date", today), /anterior/);
  state = published();
  state = apply(state, "publication_date", "2026-10-30", "schedule", "2026-10");
  state = apply(state, "publication_date", today, "complete", "2026-10");
  state = apply(state, "briefing", today, "complete", "2026-10");
  assert.throws(
    () => apply(state, "publication", today, "complete", "2026-10"),
    /agendada/,
  );
  const prior = state.months["2026-10"].briefing?.dueOn;
  state = apply(state, "publication_date", "2026-10-31", "schedule", "2026-10");
  assert.equal(state.months["2026-10"].briefing?.dueOn, prior);
});
test("materials support not applicable; Start needs every material; future completions rejected", () => {
  let state = onboarding();
  state = apply(state, "brainstorm", "2026-09-21", "complete", "coproduction");
  state = apply(
    state,
    "presentation",
    "2026-09-28",
    "complete",
    "coproduction",
  );
  assert.throws(
    () => apply(state, "start", today, "complete", "coproduction"),
    /anterior/,
  );
  for (const key of ["landing_page", "vsl", "creatives", "product"] as const)
    state = apply(state, key, today, "skip", "coproduction");
  state = apply(state, "start", today, "complete", "coproduction");
  assert.equal(state.coproduction.start?.completedOn, today);
  assert.throws(
    () => apply(newWorkflow(), "formalization", "2026-10-03"),
    /futuro/,
  );
});
test("end stops recurrence; Brazil date and short-month original anchors", () => {
  const state = published();
  refreshWorkflow(state, "2027-01-01", false);
  assert.deepEqual(Object.keys(state.months), ["2026-10"]);
  assert.throws(
    () =>
      changeTask(
        state,
        { cycle: "initial", key: "formalization", operation: "correct" },
        today,
        "coproducer",
        false,
      ),
    /encerrada/,
  );
  assert.equal(nextCreditDate("2026-01-31", "2026-01-31"), "2026-02-28");
  assert.equal(nextCreditDate("2026-01-31", "2026-02-28"), "2026-03-31");
  assert.equal(todayInBrazil(new Date("2026-10-01T02:59:59Z")), "2026-09-30");
});

test("planning materials and contract does not complete dependencies; monthly cycles are independent", () => {
  let state = apply(newWorkflow(), "formalization", "2026-10-05", "schedule");
  assert.equal(state.initial.formalization?.dueOn, "2026-10-05");
  assert.equal(state.initial.formalization?.completedOn, null);
  state = apply(
    state,
    "landing_page",
    "2026-10-10",
    "schedule",
    "coproduction",
  );
  assert.equal(state.coproduction.landing_page?.dueOn, "2026-10-10");
  assert.throws(
    () => apply(state, "feedback", today, "schedule"),
    /automático/,
  );
  state = published();
  refreshWorkflow(state, "2026-12-01", true);
  state = changeTask(
    state,
    {
      cycle: "2026-12",
      key: "publication_date",
      operation: "schedule",
      date: "2026-12-20",
    },
    "2026-12-01",
    "coproducer",
    true,
  );
  state = changeTask(
    state,
    {
      cycle: "2026-12",
      key: "publication_date",
      operation: "complete",
      date: "2026-12-01",
    },
    "2026-12-01",
    "coproducer",
    true,
  );
  assert.equal(state.months["2026-10"].publication_date?.completedOn, null);
  assert.equal(
    state.months["2026-12"].publication_date?.completedOn,
    "2026-12-01",
  );
});
