import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";
import {
  createExpertStripeOnboardingLinkForAdmin,
} from "@/lib/stripe/connect/expert-account-admin";
import { createStripeConnectClient } from "@/lib/stripe/connect/client";
import { createExpertStripeAccountRepository } from "@/lib/stripe/connect/repository";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  try {
    const { onboardingUrl } = await createExpertStripeOnboardingLinkForAdmin({
      repository: createExpertStripeAccountRepository(),
      client: createStripeConnectClient(),
      expertId: id,
      frontendAppUrl: resolveFrontendAppUrl(),
    });
    return NextResponse.json({ onboardingUrl });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}
