import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { productExistsAdmin } from "@/lib/db/product-queries";
import {
  createProductAssetObjectKey,
  getExpertAvatarAssetUrl,
  getProductCoverAssetUrl,
  parseProductUploadInput,
} from "@/lib/products/upload-input";
import {
  createProductAssetUploadUrl,
  isProductAssetsDevLocalStorageEnabled,
  PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE,
} from "@/lib/storage/product-assets-r2";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  try {
    const input = parseProductUploadInput(await request.json());
    if (
      input.kind === "content" &&
      (!input.productId || !(await productExistsAdmin(input.productId)))
    ) {
      return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
    }
    const objectKey = createProductAssetObjectKey(input, crypto.randomUUID());
    const cacheControl =
      input.kind === "cover" || input.kind === "expert-avatar"
        ? "public, max-age=31536000, immutable"
        : "private, no-store";

    const uploadUrl = isProductAssetsDevLocalStorageEnabled()
      ? "/api/products/admin/uploads/complete"
      : await createProductAssetUploadUrl({
          objectKey,
          contentType: input.contentType,
          cacheControl,
        });

    return NextResponse.json({
      uploadUrl,
      objectKey,
      assetUrl:
        input.kind === "cover"
          ? getProductCoverAssetUrl(objectKey)
          : input.kind === "expert-avatar"
            ? getExpertAvatarAssetUrl(objectKey)
            : null,
      headers: {
        "content-type": input.contentType,
        "cache-control": cacheControl,
      },
      expiresInSeconds: 5 * 60,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível preparar o envio do arquivo.";
    return NextResponse.json(
      { error: message },
      {
        status:
          message === PRODUCT_ASSETS_R2_NOT_CONFIGURED_MESSAGE ? 503 : 400,
      },
    );
  }
}
