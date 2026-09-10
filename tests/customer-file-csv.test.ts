import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_FILE_MAX_BYTES,
  CUSTOMER_FILE_MAX_ROWS,
  customerFileCorrectionReport,
  isCustomerFilePreviewCurrent,
  prepareCustomerFileCsv,
  reviewCustomerFileConfirmation,
} from "../lib/meta-business/marketing/audiences/customer-file";

const context = {
  customerId: "customer-1",
  adAccountId: "act_1",
  audienceId: "audience-1",
  operation: "add" as const,
};

test("previews valid identifiers independently and preserves an explicit international prefix", () => {
  const preview = prepareCustomerFileCsv({
    bytes: new TextEncoder().encode("email,phone\nCLIENTE@EXAMPLE.COM,+1 415 555 2671\nvalid@example.com,9999\n,11987654321\n"),
    mapping: { emailColumn: "email", phoneColumn: "phone" },
    context,
    now: new Date("2026-09-09T12:00:00.000Z"),
  });

  assert.equal(preview.counts.read, 3);
  assert.equal(preview.counts.valid, 3);
  assert.equal(preview.counts.invalid, 0);
  assert.deepEqual(preview.rows[0].identifiers, { email: "cliente@example.com", phone: "+14155552671" });
  assert.deepEqual(preview.rows[1].identifiers, { email: "valid@example.com" });
  assert.match(preview.rows[1].warnings[0]!.message, /DDD|telefone/i);
  assert.deepEqual(preview.rows[2].identifiers, { phone: "+5511987654321" });
  assert.equal(preview.referenceCountry, "BR");
});

test("counts non-empty data rows before validity and requires an explicit valid-only choice", () => {
  const preview = prepareCustomerFileCsv({
    bytes: new TextEncoder().encode("email,phone\ninvalid,9999\n\nvalid@example.com,\n"),
    mapping: { emailColumn: "email", phoneColumn: "phone" },
    context,
  });

  assert.deepEqual(preview.counts, { read: 2, valid: 1, invalid: 1, warnings: 2, duplicatesRemoved: 0 });
  assert.deepEqual(reviewCustomerFileConfirmation(preview, false), { allowed: false, reason: "EXPLICIT_VALID_ROWS_CONSENT_REQUIRED" });
  assert.deepEqual(reviewCustomerFileConfirmation(preview, true), { allowed: true });
  assert.match(customerFileCorrectionReport(preview), /invalid/);
});

test("requires correction rather than silently dropping invalid rows for a replacement", () => {
  const preview = prepareCustomerFileCsv({
    bytes: new TextEncoder().encode("email\ninvalid\nvalid@example.com\n"),
    mapping: { emailColumn: "email" },
    context: { ...context, operation: "replace" },
  });

  assert.deepEqual(reviewCustomerFileConfirmation(preview, true), { allowed: false, reason: "REPLACEMENT_REQUIRES_CORRECTED_FILE" });
});

test("invalidates a review when its mapping, country, audience, or operation changes", () => {
  const preview = prepareCustomerFileCsv({
    bytes: new TextEncoder().encode("email,phone\nvalid@example.com,11987654321\n"),
    mapping: { emailColumn: "email", phoneColumn: "phone" }, context,
  });

  assert.equal(isCustomerFilePreviewCurrent(preview, preview), true);
  assert.equal(isCustomerFilePreviewCurrent(preview, { ...preview, referenceCountry: "US" }), false);
  assert.equal(isCustomerFilePreviewCurrent(preview, { ...preview, context: { ...context, operation: "remove" } }), false);
});

test("rejects CSVs at either capacity ceiling without truncating", () => {
  assert.throws(() => prepareCustomerFileCsv({
    bytes: new Uint8Array(CUSTOMER_FILE_MAX_BYTES + 1),
    mapping: { emailColumn: "email" }, context,
  }), /20 MB/);

  const rows = ["email", ...Array.from({ length: CUSTOMER_FILE_MAX_ROWS + 1 }, (_, index) => `person${index}@example.com`)];
  assert.throws(() => prepareCustomerFileCsv({
    bytes: new TextEncoder().encode(rows.join("\n")),
    mapping: { emailColumn: "email" }, context,
  }), /100\.000/);
});

test("expires correction data from its original receipt time and never emits executable spreadsheet cells", () => {
  const receivedAt = new Date("2026-09-09T12:00:00.000Z");
  const preview = prepareCustomerFileCsv({
    bytes: new TextEncoder().encode("email\n=HYPERLINK\n"),
    mapping: { emailColumn: "email" }, context, now: receivedAt,
  });

  assert.match(customerFileCorrectionReport(preview, new Date("2026-09-09T12:00:00.000Z")), /'=HYPERLINK/);
  assert.throws(() => customerFileCorrectionReport(preview, new Date("2026-09-10T12:00:00.001Z")), /novo arquivo/i);
});

test("neutralizes formulas hidden behind a leading tab or carriage return", () => {
  const receivedAt = new Date("2026-09-09T12:00:00.000Z");
  // A spreadsheet skips the leading control character and still evaluates the
  // formula, so a report that only guards `=+-@` hands the user a live cell.
  for (const lead of ["\t", "\r"]) {
    const preview = prepareCustomerFileCsv({
      bytes: new TextEncoder().encode(`email\n"${lead}=HYPERLINK"\n`),
      mapping: { emailColumn: "email" }, context, now: receivedAt,
    });
    const csv = customerFileCorrectionReport(preview, receivedAt);
    assert.match(csv, /'/, `célula iniciada por ${JSON.stringify(lead)} precisa ser neutralizada`);
    assert.doesNotMatch(
      csv,
      new RegExp(`"${lead === "\t" ? "\\t" : "\\r"}=`),
      `${JSON.stringify(lead)} seguido de = não pode chegar cru à planilha`,
    );
  }
});
