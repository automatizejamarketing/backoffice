import assert from "node:assert/strict";
import test from "node:test";
import { extractPixCopyPasteCode } from "./pix-payment-utils";

test("extractPixCopyPasteCode reads qr_code from payment response", () => {
  assert.equal(
    extractPixCopyPasteCode({
      point_of_interaction: {
        transaction_data: {
          qr_code: "00020126580014BR.GOV.BCB.PIX",
        },
      },
    }),
    "00020126580014BR.GOV.BCB.PIX",
  );
});

test("extractPixCopyPasteCode returns null when qr_code is missing", () => {
  assert.equal(extractPixCopyPasteCode({}), null);
});
