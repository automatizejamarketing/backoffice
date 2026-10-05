import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  addPartner,
  cancelInvite,
  invitePerson,
  listPartners,
  listPendingPeople,
  removePartner,
} from "@/lib/meta-business/access-grant-test";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";

const ACTIONS = [
  "list",
  "add_partner",
  "remove_partner",
  "invite_person",
  "cancel_invite",
] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Test tool (see lib/meta-business/access-grant-test.ts). Only runs on a
 * consultant's click; every action also returns the current partners and
 * pending invitations so the result is visible right away.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:write");
  if (!authz.ok) return authz.response;

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    businessId?: string;
    email?: string;
    pendingUserId?: string;
  };
  const action = (ACTIONS as readonly string[]).includes(body.action ?? "")
    ? (body.action as Action)
    : "list";
  const businessId = body.businessId?.trim() ?? "";
  const email = body.email?.trim() ?? "";
  const pendingUserId = body.pendingUserId?.trim() ?? "";

  if ((action === "add_partner" || action === "remove_partner") && !/^\d{6,}$/.test(businessId)) {
    return NextResponse.json({ message: "Informe o ID numérico do BM parceiro." }, { status: 400 });
  }
  if (action === "invite_person" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ message: "Informe um e-mail válido." }, { status: 400 });
  }
  if (action === "cancel_invite" && !/^\d{6,}$/.test(pendingUserId)) {
    return NextResponse.json({ message: "Informe o ID do convite pendente." }, { status: 400 });
  }

  const tokenResult = await getUserAccessTokenByUserId(id);
  if (!tokenResult.success) {
    return NextResponse.json(
      { message: tokenResult.error.message },
      { status: tokenResult.error.statusCode },
    );
  }
  const { accessToken: token, connection } = tokenResult;
  const first = connection.assignedAssets?.adAccounts?.[0];
  const adAccountId = first?.accountId ?? first?.id ?? null;
  const clientBusinessId = connection.clientBusinessId;

  let result = null;
  if (action === "add_partner" || action === "remove_partner") {
    if (!adAccountId) {
      return NextResponse.json({ message: "Cliente sem conta de anúncios." }, { status: 404 });
    }
    result =
      action === "add_partner"
        ? await addPartner(token, adAccountId, businessId)
        : await removePartner(token, adAccountId, businessId);
  } else if (action === "invite_person" || action === "cancel_invite") {
    if (!clientBusinessId) {
      return NextResponse.json({ message: "Conexão sem BM do cliente." }, { status: 404 });
    }
    result =
      action === "invite_person"
        ? await invitePerson(token, clientBusinessId, email)
        : await cancelInvite(token, pendingUserId);
  }

  const [partners, pending] = await Promise.all([
    adAccountId ? listPartners(token, adAccountId) : null,
    clientBusinessId ? listPendingPeople(token, clientBusinessId) : null,
  ]);

  console.log("[access-grant-test]", {
    userId: id,
    actor: authz.actor.email,
    action,
    target: businessId || email || pendingUserId || null,
    ok: result?.ok ?? null,
    code: result?.code ?? null,
    subcode: result?.subcode ?? null,
  });

  return NextResponse.json({
    adAccountId,
    clientBusinessId,
    tokenKind: connection.tokenKind,
    action,
    result,
    partners,
    pending,
  });
}
