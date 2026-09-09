import { describe, expect, test } from "bun:test";
import {
  decideDisputeDefenceSubmission,
  detectDefenceContentType,
  MAX_DEFENCE_FILE_BYTES,
} from "./dispute-defense";

const baseCase = {
  status: "open_full" as const,
  deadlineAt: null,
  originalProviderAccountId: "collector-1",
  submittedAt: null,
  submissionState: "draft" as const,
};

describe("defence upload facts", () => {
  test("detects the accepted real signatures", () => {
    expect(detectDefenceContentType(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(detectDefenceContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectDefenceContentType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectDefenceContentType(new TextEncoder().encode("not-an-image"))).toBeNull();
  });

  test("keeps size and type checks active at submission", () => {
    expect(
      decideDisputeDefenceSubmission({
        case: {
          ...baseCase,
          files: [{ name: "evidence.pdf", contentType: "application/zip", size: 20 }],
        },
        reviewed: true,
        now: new Date("2026-09-09T12:00:00.000Z"),
      }),
    ).toEqual({ allowed: false, reason: "invalid_file" });
    expect(
      decideDisputeDefenceSubmission({
        case: {
          ...baseCase,
          files: [{ name: "evidence.pdf", contentType: "application/pdf", size: MAX_DEFENCE_FILE_BYTES + 1 }],
        },
        reviewed: true,
        now: new Date("2026-09-09T12:00:00.000Z"),
      }),
    ).toEqual({ allowed: false, reason: "invalid_file" });
  });
});

