import { describe, expect, test } from "bun:test";
import {
  normalizeWhatsappHistoryFilters,
  summarizeWhatsappDeliveryRows,
} from "./whatsapp-history-model";

describe("WhatsApp delivery history filters", () => {
  const now = new Date("2026-08-07T15:00:00.000Z");

  test("defaults to the last seven Sao Paulo calendar days", () => {
    expect(normalizeWhatsappHistoryFilters({}, now)).toEqual({
      fromDate: "2026-08-01",
      throughDate: "2026-08-07",
      gte: new Date("2026-08-01T03:00:00.000Z"),
      lt: new Date("2026-08-08T03:00:00.000Z"),
      query: "",
      template: null,
      status: null,
      page: 1,
      pageSize: 50,
    });
  });

  test("keeps valid custom filters and normalizes invalid values", () => {
    expect(
      normalizeWhatsappHistoryFilters(
        {
          from: "2026-07-10",
          to: "2026-07-20",
          q: "  maria@example.com  ",
          template: "pix_renovacao_v2",
          status: "read",
          page: "3",
        },
        now,
      ),
    ).toMatchObject({
      fromDate: "2026-07-10",
      throughDate: "2026-07-20",
      query: "maria@example.com",
      template: "pix_renovacao_v2",
      status: "read",
      page: 3,
    });

    expect(
      normalizeWhatsappHistoryFilters(
        { from: "invalid", to: "2027-01-01", status: "unknown", page: "0" },
        now,
      ),
    ).toMatchObject({
      fromDate: "2026-08-01",
      throughDate: "2026-08-07",
      status: null,
      page: 1,
    });
  });
});

describe("WhatsApp delivery history metrics", () => {
  test("counts accepted, delivered, read, failed, and historical independently", () => {
    const sentAt = new Date("2026-08-07T12:00:00.000Z");
    const readAt = new Date("2026-08-07T12:05:00.000Z");
    const failedAt = new Date("2026-08-07T12:06:00.000Z");

    expect(
      summarizeWhatsappDeliveryRows([
        {
          acceptedAt: sentAt,
          deliveredAt: null,
          readAt: null,
          failedAt: null,
          historicalStatusUntracked: true,
        },
        {
          acceptedAt: sentAt,
          deliveredAt: null,
          readAt,
          failedAt: null,
          historicalStatusUntracked: false,
        },
        {
          acceptedAt: sentAt,
          deliveredAt: null,
          readAt: null,
          failedAt,
          historicalStatusUntracked: false,
        },
      ]),
    ).toEqual({
      sent: 3,
      delivered: 1,
      read: 1,
      failed: 1,
      historicalUntracked: 1,
    });
  });
});
