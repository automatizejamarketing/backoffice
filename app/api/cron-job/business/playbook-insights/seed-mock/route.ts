import { NextResponse, type NextRequest } from "next/server";
import { assertCronAuthorized } from "@/lib/auth/cron-auth";
import { resolveAppEnv } from "@/lib/env/load-env";
import {
  resolveUserIdForMockSeed,
  seedMockPlaybookInsights,
} from "@/lib/playbook-insights/seed-mock-insights";

export const maxDuration = 60;

function mockSeedAllowed(): boolean {
  if (process.env.PLAYBOOK_INSIGHTS_ALLOW_MOCK === "true") return true;
  const appEnv = resolveAppEnv(process.env.APP_ENV);
  if (appEnv === "staging" || appEnv === "local") return true;
  // Staging branch deployments sometimes ship with APP_ENV unset/prod.
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim().toLowerCase();
  return branch === "staging";
}

/**
 * Staging/local helper: insert synthetic playbook.* insights for a user
 * so Carteira + Marketing panel can be demoted without Meta Graph.
 *
 * GET ?email=user@example.com
 * GET ?userId=<uuid>
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const auth = assertCronAuthorized(request, "[playbook-insights-seed-mock]");
  if (!auth.ok) return auth.response;

  if (!mockSeedAllowed()) {
    return NextResponse.json(
      {
        error:
          "Mock playbook seed is disabled in this environment (set PLAYBOOK_INSIGHTS_ALLOW_MOCK=true or use staging/local)",
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
