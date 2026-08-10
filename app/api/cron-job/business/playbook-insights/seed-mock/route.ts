import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import {
  isMetaFakeScenarioEnvAllowed,
  isMetaFakeScenarioUser,
} from "@/lib/meta-fake/config";
import {
  resolveUserIdForMockSeed,
  seedMockPlaybookInsights,
} from "@/lib/playbook-insights/seed-mock-insights";

export const maxDuration = 60;

/**
 * Staging/local helper: insert synthetic playbook.* insights for an
 * allowlisted fake-scenario user so Carteira + Marketing panel can be
 * demoted without Meta Graph. Uses DB-configured thresholds.
 *
 * GET ?email=user@example.com
 * GET ?userId=<uuid>
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[playbook-insights-seed-mock]");
  if (!auth.ok) return auth.response;

  if (!isMetaFakeScenarioEnvAllowed()) {
    return NextResponse.json(
      {
        error:
          "Fake Meta scenario runners are disabled in this environment (staging/local only)",
      },
      { status: 403 },
    );
  }

  const email = request.nextUrl.searchParams.get("email");
  const userId = request.nextUrl.searchParams.get("userId");
  if (!email && !userId) {
    return NextResponse.json(
      { error: "Pass ?email= or ?userId=" },
      { status: 400 },
    );
  }

  try {
    const target = await resolveUserIdForMockSeed({ userId, email });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!isMetaFakeScenarioUser(target.userId)) {
      return NextResponse.json(
        {
          error:
            "User is not in META_FAKE_SCENARIO_USER_IDS (or fake mode is disabled)",
          userId: target.userId,
        },
        { status: 403 },
      );
    }

    const result = await seedMockPlaybookInsights(target);
    console.log("[playbook-insights-seed-mock] completed", result);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[playbook-insights-seed-mock] failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to seed mock playbook insights",
      },
      { status: 500 },
    );
  }
}
