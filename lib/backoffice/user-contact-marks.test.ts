import { describe, expect, test } from "bun:test";
import {
  parseUserContactMarks,
  serializeUserContactMarks,
  setUserContactMark,
} from "./user-contact-marks";

const userA = "550e8400-e29b-41d4-a716-446655440000";
const userB = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

describe("user contact marks", () => {
  test("parses compact JSON ids and expands them back to UUIDs", () => {
    expect(
      parseUserContactMarks(
        serializeUserContactMarks([userA, userB, "not-an-id"]),
      ),
    ).toEqual([userA, userB]);
  });

  test("parses a comma-separated fallback payload", () => {
    expect(parseUserContactMarks(`${userA},${userB}`)).toEqual([userA, userB]);
  });

  test("adds and removes a mark without duplicating", () => {
    expect(setUserContactMark([userA], userA, true)).toEqual([userA]);
    expect(setUserContactMark([userA], userB, true)).toEqual([userA, userB]);
    expect(setUserContactMark([userA, userB], userA, false)).toEqual([userB]);
  });

  test("returns an empty list for blank input", () => {
    expect(parseUserContactMarks(null)).toEqual([]);
    expect(parseUserContactMarks("")).toEqual([]);
  });
});
