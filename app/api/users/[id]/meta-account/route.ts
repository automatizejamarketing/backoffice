import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { sanitizeMetaBusinessAccount } from "@/lib/meta-business/sanitize";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id);
  if (!authz.ok) return authz.response;

  const account = await getUserMetaBusinessAccount(id);
  return Response.json(sanitizeMetaBusinessAccount(account));
}
