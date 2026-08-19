import { getUserActivityDayUsers } from "@/lib/db/admin-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  isUserActivityCalendarDate,
  isUserActivitySeriesKey,
} from "@/lib/backoffice/user-activity-dashboard";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("dashboard:view");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const series = searchParams.get("series");

  if (!isUserActivityCalendarDate(date) || !isUserActivitySeriesKey(series)) {
    return Response.json({ error: "Invalid date or series" }, { status: 400 });
  }

  const users = await getUserActivityDayUsers(date, series);

  return Response.json({
    date,
    series,
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      expirationDate: user.expirationDate?.toISOString() ?? null,
    })),
  });
}
