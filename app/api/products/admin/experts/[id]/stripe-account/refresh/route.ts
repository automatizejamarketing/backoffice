import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  describeExpertStripeAccount,
  refreshExpertStripeAccountForAdmin,
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
    const record = await refreshExpertStripeAccountForAdmin({
      repository: createExpertStripeAccountRepository(),
      client: createStripeConnectClient(),
      expertId: id,
    });
    return NextResponse.json(describeExpertStripeAccount(record));
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}
