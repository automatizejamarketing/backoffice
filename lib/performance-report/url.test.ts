import { afterEach, describe, expect, test } from "bun:test";
import {
  buildCampaignWorkspaceUrl,
  buildPerformanceReportUrl,
} from "./url";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalAuthUrl = process.env.AUTH_URL;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  process.env.AUTH_URL = originalAuthUrl;
  process.env.NEXTAUTH_URL = originalNextAuthUrl;
});

describe("performance report URLs", () => {
  test("carries only user id and filters — never the Slack message or email", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://backoffice-staging.example/";
    const url = buildPerformanceReportUrl({
      userId: "user-123",
      view: "report",
      accountId: "act_999",
      datePreset: "last_30d",
    });

    expect(url).toBe(
      "https://backoffice-staging.example/users/user-123?tab=marketing&view=report&accountId=act_999&datePreset=last_30d",
    );
    expect(url.includes("email=")).toBe(false);
    expect(url.includes("msg=")).toBe(false);
    expect(url.includes("@")).toBe(false);
  });

  test("uses since/until instead of datePreset for a custom window", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://backoffice.example";
    const url = buildPerformanceReportUrl({
      userId: "user-1",
      since: "2026-08-01",
      until: "2026-08-20",
    });
    expect(url).toContain("since=2026-08-01");
    expect(url).toContain("until=2026-08-20");
    expect(url.includes("datePreset=")).toBe(false);
  });

  test("campaign workspace links stay on the marketing tab without view=report", () => {
    const path = buildCampaignWorkspaceUrl({
      userId: "user-1",
      accountId: "act_1",
      campaignId: "120",
      datePreset: "last_7d",
    });
    expect(path).toBe(
      "/users/user-1?tab=marketing&accountId=act_1&campaignId=120&datePreset=last_7d",
    );
    expect(path.includes("view=report")).toBe(false);
  });
});
