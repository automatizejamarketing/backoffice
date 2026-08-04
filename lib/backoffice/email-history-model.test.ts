import { describe, expect, test } from "bun:test";
import {
  isEmailDeliveryStatus,
  summarizeEmailHistory,
  type EmailHistoryItem,
} from "./email-history-model";

function email(status: EmailHistoryItem["status"]): EmailHistoryItem {
  return {
    id: status,
    createdAt: "2026-08-04T12:00:00.000Z",
    from: "AutomatizeJá <contato@example.com>",
    to: ["cliente@example.com"],
    subject: "Assunto",
    status,
  };
}

describe("email history", () => {
  test("summarizes delivery, engagement and delivery problems", () => {
    expect(
      summarizeEmailHistory([
        email("delivered"),
        email("opened"),
        email("clicked"),
        email("failed"),
        email("queued"),
      ]),
    ).toEqual({ total: 5, delivered: 3, engaged: 2, problems: 1 });
  });

  test("accepts only statuses returned by Resend", () => {
    expect(isEmailDeliveryStatus("delivery_delayed")).toBe(true);
    expect(isEmailDeliveryStatus("unknown")).toBe(false);
    expect(isEmailDeliveryStatus(undefined)).toBe(false);
  });
});
