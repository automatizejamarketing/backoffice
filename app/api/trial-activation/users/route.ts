import { getTrialActivationUsers } from "@/lib/db/admin-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("dashboard:view");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date || !DATE_PATTERN.test(date)) {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }

  const users = await getTrialActivationUsers(date);

  return Response.json({
    date,
    users: users.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      signedUpAt: row.signedUpAt?.toISOString() ?? null,
      activatedAt: new Date(row.activatedAt).toISOString(),
      expirationDate: row.expirationDate?.toISOString() ?? null,
      activeToday: row.activeToday,
      paid: row.paid,
    })),
  });
}
