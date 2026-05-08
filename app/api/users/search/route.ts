import { searchUsersByEmail } from "@/lib/db/admin-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.length < 3) {
    return Response.json([]);
  }

  const users = await searchUsersByEmail(query);
  return Response.json(users);
}
