import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getProductAsset, isAllowedProductAssetObjectKey } from "@/lib/storage/product-assets-r2";

const PRODUCT_ASSETS_DEV_PROXY_ORIGIN =
  process.env.PRODUCT_ASSETS_DEV_PROXY_ORIGIN?.replace(/\/+$/, "") ??
  "https://www.automatizemarketing.com";

async function proxyProductAssetFromOrigin(objectKey: string) {
  const proxyUrl = `${PRODUCT_ASSETS_DEV_PROXY_ORIGIN}/api/products/assets?key=${encodeURIComponent(objectKey)}`;
  const response = await fetch(proxyUrl, { cache: "no-store" });
  if (!response.ok || !response.body) {
    return null;
  }

  return new Response(response.body, {
    headers: {
      "cache-control":
        response.headers.get("cache-control") ?? "private, max-age=300",
      "content-type":
        response.headers.get("content-type") ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    },
  });
}

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
    if (process.env.NODE_ENV === "development") {
      const proxied = await proxyProductAssetFromOrigin(objectKey);
      if (proxied) return proxied;
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
