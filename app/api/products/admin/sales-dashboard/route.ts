import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  buildProductSalesDashboard,
  resolveProductSalesWindow,
} from "@/lib/backoffice/product-sales-dashboard";
import {
  listProductSalesFilterOptions,
  listProductSalesRows,
} from "@/lib/db/product-sales-queries";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const params = new URL(request.url).searchParams;
  const window = resolveProductSalesWindow({
    from: params.get("from"),
    to: params.get("to"),
  });
  const productIds = (params.get("productIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID_PATTERN.test(value));

  const [rows, products] = await Promise.all([
    listProductSalesRows({ gte: window.gte, lt: window.lt, productIds }),
    listProductSalesFilterOptions(),
  ]);

  return NextResponse.json({
    window: {
      fromDate: window.fromDate,
      throughDate: window.throughDate,
      bucket: window.bucket,
    },
    productIds,
    products,
    ...buildProductSalesDashboard(rows, window),
  });
}
