import { type NextRequest, NextResponse } from "next/server";

import { acceptCustomAudienceTos } from "@/lib/meta-business/marketing/audiences/tos";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { customerFileImportDependencies } from "../dependencies";
import { customerFileActor, customerFileErrorResponse } from "../shared";

export async function GET(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  try {
    const { accountId } = await params;
    const actor = await customerFileActor(request.nextUrl.searchParams.get("userId"));
    return NextResponse.json(await customerFileImportDependencies({ actor, adAccountId: accountId }).termsState());
  } catch (error) {
    return customerFileErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  try {
    const { accountId } = await params;
    const actor = await customerFileActor(request.nextUrl.searchParams.get("userId"));
    const deps = customerFileImportDependencies({ actor, adAccountId: accountId });
    await deps.authorize({ stage: "start", target: { adAccountId: accountId, operation: "create" } });
    const token = await getUserAccessTokenByUserId(actor.customerId);
    if (!token.success) return NextResponse.json(token.error, { status: token.error.statusCode });
    const accepted = await acceptCustomAudienceTos({ adAccountId: accountId, accessToken: token.accessToken });
    if (!accepted.ok) return NextResponse.json(accepted, { status: 409 });
    return NextResponse.json(await deps.termsState());
  } catch (error) {
    return customerFileErrorResponse(error);
  }
}
