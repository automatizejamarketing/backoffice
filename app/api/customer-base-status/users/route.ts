import { getCustomerBaseStatusUsers } from "@/lib/db/admin-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import type { CustomerBaseCategory } from "@/lib/backoffice/customer-base-status";

const CATEGORY_VALUES = [
  "activePaying",
  "trial",
  "churn",
  "scheduledCancel",
] as const satisfies readonly CustomerBaseCategory[];

function parseCategory(value: string | null): CustomerBaseCategory | null {
  if (!value) return null;
  return CATEGORY_VALUES.includes(value as CustomerBaseCategory)
    ? (value as CustomerBaseCategory)
    : null;
}

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("dashboard:view");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const category = parseCategory(searchParams.get("category"));

  if (!category) {
    return Response.json({ error: "Invalid category" }, { status: 400 });
  }

  const users = await getCustomerBaseStatusUsers(category);

  return Response.json({
    category,
    users: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      expirationDate: user.expirationDate?.toISOString() ?? null,
      phone: user.phone,
      totalPaidCentavos: user.totalPaidCentavos,
      lastPaymentProvider: user.lastPaymentProvider,
      lastPaymentMethod: user.lastPaymentMethod ?? null,
    })),
  });
}
