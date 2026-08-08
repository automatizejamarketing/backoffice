import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  isAllowedProductAssetObjectKey,
  PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE,
  putProductAsset,
} from "@/lib/storage/product-assets-r2";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const objectKey = request.headers.get("x-object-key")?.trim();
  const contentType =
    request.headers.get("content-type")?.trim() || "application/octet-stream";
  const cacheControl =
    request.headers.get("x-cache-control")?.trim() || "private, no-store";

  if (!objectKey || !isAllowedProductAssetObjectKey(objectKey)) {
    return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
  }

  try {
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength === 0) {
      return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
    }

    await putProductAsset({
      objectKey,
      contentType,
      cacheControl,
      body,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível enviar o arquivo para o armazenamento.";
    return NextResponse.json(
      { error: message },
      {
        status:
          message === PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE ? 503 : 500,
      },
    );
  }
}
