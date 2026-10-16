import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
test("capture/ambassador migration is mirrored above both shared watermarks without editing history", () => {
  const back = "lib/db/migrations";
  const front = join(
    process.env.FRONTEND_ROOT ?? "../frontend",
    "lib/db/migrations",
  );
  const backJournal = JSON.parse(
    readFileSync(join(back, "meta/_journal.json"), "utf8"),
  ).entries;
  const frontJournal = JSON.parse(
    readFileSync(join(front, "meta/_journal.json"), "utf8"),
  ).entries;
  const a = backJournal.find(
    (entry: { tag: string }) => entry.tag === "0120_capture_ambassadors",
  );
  const b = frontJournal.find(
    (entry: { tag: string }) => entry.tag === "0127_capture_ambassadors",
  );
  assert.equal(a.when, b.when);
  assert.ok(
    a.when >
      Math.max(
        ...backJournal
          .filter((e: { idx: number }) => e.idx < a.idx)
          .map((e: { when: number }) => e.when),
        ...frontJournal
          .filter((e: { idx: number }) => e.idx < b.idx)
          .map((e: { when: number }) => e.when),
      ),
  );
  assert.equal(
    readFileSync(join(back, a.tag + ".sql"), "utf8"),
    readFileSync(join(front, b.tag + ".sql"), "utf8"),
  );
});
