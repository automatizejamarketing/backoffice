import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  MANUAL_LINK_ADMIN_ONLY_MESSAGE,
  MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE,
  MANUAL_LINK_INVALID_USER_MESSAGE,
  manualLinkActorAllowed,
} from "@/lib/referral/manual-link";
import { previewManualReferralLink } from "@/lib/referral/manual-link-queries";
import { ReferralOperationError } from "@/lib/referral/queries";

type Context = { params: Promise<{ affiliateId: string }> };

/**
 * A prévia do vínculo manual (spec 2026-10-11, R9): só leitura. As recusas
 * 409 do vínculo voltam como `blocked.message`, com 200 — a prévia informa, o
 * POST decide.
 */
export async function GET(request: Request, context: Context) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;
  if (!manualLinkActorAllowed(authz.actor)) {
    return NextResponse.json({ error: MANUAL_LINK_ADMIN_ONLY_MESSAGE }, { status: 403 });
  }

  const affiliateId = z.string().uuid().safeParse((await context.params).affiliateId);
  if (!affiliateId.success) {
    return NextResponse.json({ error: MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE }, { status: 404 });
  }
  const userId = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("userId"));
  if (!userId.success) {
    return NextResponse.json({ error: MANUAL_LINK_INVALID_USER_MESSAGE }, { status: 400 });
  }

  try {
    return NextResponse.json(await previewManualReferralLink(affiliateId.data, userId.data));
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[referral] failed to preview manual link", error);
    return NextResponse.json({ error: "Erro ao carregar a prévia" }, { status: 500 });
  }
}
