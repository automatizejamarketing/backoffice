import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const token = process.env.PRODUCT_CONTENT_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "O armazenamento privado dos produtos não está configurado neste ambiente.",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = JSON.parse(clientPayload ?? "{}") as {
          productId?: unknown;
        };
        if (
          typeof payload.productId !== "string" ||
          !pathname.startsWith(`products/${payload.productId}/`)
        ) {
          throw new Error("Destino do arquivo inválido");
        }

        return {
          maximumSizeInBytes: MAX_FILE_SIZE,
          addRandomSuffix: false,
        };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("maximum")
        ? "O arquivo deve ter no máximo 50 MB."
        : error instanceof Error && error.message.includes("private")
          ? "O storage configurado precisa ser privado."
          : error instanceof Error && error.message
            ? error.message
            : "Não foi possível preparar o envio do arquivo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
