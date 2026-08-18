import { getPayerRetentionCohortUsers } from "@/lib/db/admin-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

const WEEK_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("dashboard:view");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week");

  if (!week || !WEEK_PATTERN.test(week)) {
    return Response.json({ error: "Invalid week" }, { status: 400 });
  }

  const users = await getPayerRetentionCohortUsers(week);

  return Response.json({
    week,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      firstPaidAt: new Date(user.firstPaidAt).toISOString(),
      expirationDate: user.expirationDate?.toISOString() ?? null,
      activeToday: user.activeToday,
    })),
  });
}
