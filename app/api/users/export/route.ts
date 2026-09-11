import {
  getAllUsersWithUsage,
  USER_EXPORT_MAX_ROWS,
} from "@/lib/db/admin-queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  buildUsersCsv,
  buildUsersExportFilename,
} from "@/lib/backoffice/users-csv";
import { normalizeUsersFilterParams } from "@/lib/backoffice/users-filters";

export const dynamic = "force-dynamic";

function sanitizeFilename(input: string): string {
  const cleaned = input
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7f]/g, "-")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (cleaned.length > 0 ? cleaned : "usuarios").slice(0, 120);
}

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const filters = normalizeUsersFilterParams(
    Object.fromEntries(searchParams.entries()),
  );
  const { search } = filters;

  const { users, total } = await getAllUsersWithUsage({
    search,
    filters,
    exportAll: true,
  });

  if (total > USER_EXPORT_MAX_ROWS) {
    return Response.json(
      {
        error: "Limite excedido",
        message: `A exportação suporta no máximo ${USER_EXPORT_MAX_ROWS.toLocaleString("pt-BR")} usuários. Refine os filtros e tente novamente.`,
      },
      { status: 413 },
    );
  }

  const csv = buildUsersCsv(users);
  const filename = sanitizeFilename(buildUsersExportFilename(total));
  const encodedFilename = encodeURIComponent(
    buildUsersExportFilename(total),
  ).replace(/['()]/g, escape);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
      "Cache-Control": "no-store",
    },
  });
}
