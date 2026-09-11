import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expirationCalendarDate,
  expirationCalendarInput,
  expirationInputToEndOfDay,
} from "./expiration-date";

test("expiration includes the entire selected day in São Paulo", () => {
  assert.equal(expirationInputToEndOfDay("2026-09-14").toISOString(), "2026-09-15T02:59:59.999Z");
  assert.equal(expirationInputToEndOfDay("2026-09-14T12:00:00Z").toISOString(), "2026-09-15T02:59:59.999Z");
  assert.equal(expirationInputToEndOfDay("2028-02-29").toISOString(), "2028-03-01T02:59:59.999Z");
});

test("invalid input cannot silently roll into another month", () => {
  for (const value of [null, 123, {}, "", "2026-02-29", "2026-09-31", "2026-13-01", "2026-00-01", "invalid"]) {
    assert.throws(() => expirationInputToEndOfDay(value));
  }
});

test("calendar and quick adjustments use the displayed São Paulo day", () => {
  const calendar = expirationCalendarDate(new Date("2026-09-11T02:59:59.999Z"));
  assert.equal(expirationCalendarInput(calendar), "2026-09-10");
  calendar.setDate(calendar.getDate() + 7);
  assert.equal(expirationCalendarInput(calendar), "2026-09-17");
  calendar.setDate(calendar.getDate() - 30);
  assert.equal(expirationCalendarInput(calendar), "2026-08-18");
});
