import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  createProductDisputeDefenceUploadGrant,
  ProductDisputeDefenceError,
} from "@/lib/products/dispute-defense-service";
import {
  createProductAssetUploadUrl,
  isProductAssetsDevLocalStorageEnabled,
  PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE,
} from "@/lib/storage/product-assets-r2";

function safeFilename(value: string) {
  const clean = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean.slice(0, 120) || "evidencia";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ disputeId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    const { disputeId } = await context.params;
    const body = (await request.json()) as { fileName?: string; contentType?: string; sizeBytes?: number };
    const fileName = safeFilename(body.fileName ?? "");
    const contentType = String(body.contentType ?? "application/octet-stream").trim().toLowerCase();
    const sizeBytes = Number(body.sizeBytes);
    if (!fileName || !contentType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
    }
    const grant = await createProductDisputeDefenceUploadGrant({
      disputeId,
      fileName,
      contentType,
      sizeBytes,
    });
    const cacheControl = "private, no-store";
    const uploadUrl = isProductAssetsDevLocalStorageEnabled()
      ? "/api/products/admin/uploads/complete"
      : await createProductAssetUploadUrl({ objectKey: grant.objectKey, contentType: grant.contentType, cacheControl });
    return NextResponse.json({
      uploadUrl,
      grantId: grant.grantId,
      objectKey: grant.objectKey,
      headers: { "content-type": grant.contentType, "cache-control": cacheControl },
      expiresInSeconds: 5 * 60,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível preparar o envio.";
    return NextResponse.json(
      { error: message },
      {
        status:
          error instanceof ProductDisputeDefenceError
            ? error.status
            : message === PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE
              ? 503
              : 400,
      },
    );
  }
}
