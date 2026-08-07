import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getProductAsset, isAllowedProductAssetObjectKey } from "@/lib/storage/product-assets-r2";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const objectKey = new URL(request.url).searchParams.get("key");
  if (!objectKey || !isAllowedProductAssetObjectKey(objectKey)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const result = await getProductAsset(objectKey);
    if (!result.Body) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = result.Body as unknown as {
      transformToWebStream(): ReadableStream;
    };
    return new Response(body.transformToWebStream(), {
      headers: {
        "cache-control": "private, max-age=300",
        "content-type": result.ContentType ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
