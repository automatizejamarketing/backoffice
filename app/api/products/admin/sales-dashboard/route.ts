import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  buildProductSalesDashboard,
  resolveProductSalesPeriod,
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
  const window = resolveProductSalesWindow(
    resolveProductSalesPeriod(params.get("period")),
  );
  const rawProductId = params.get("productId");
  const productId =
    rawProductId && UUID_PATTERN.test(rawProductId) ? rawProductId : undefined;

  const [rows, products] = await Promise.all([
    listProductSalesRows({ gte: window.gte, lt: window.lt, productId }),
    listProductSalesFilterOptions(),
  ]);

  return NextResponse.json({
    window: {
      period: window.period,
      fromDate: window.fromDate,
      throughDate: window.throughDate,
      bucket: window.bucket,
    },
    productId: productId ?? null,
    products,
    ...buildProductSalesDashboard(rows, window),
  });
}
