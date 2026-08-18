import { NextResponse } from "next/server";
import { requireBackofficePermission } from "@/lib/auth/rbac";
import { createMediaUploadUrl } from "@/lib/storage/media-r2";

// O comprovante do repasse sobe por AQUI, não por URL colada: o operador anexa
// o arquivo (print ou PDF do Pix), ele vai para o R2 (bucket de mídia) e a URL
// resultante é a que `decide` persiste em `proof_url`. Rota separada da decisão
// porque o upload pode ser refeito à vontade — só o `decide` muda estado.
//
// Client upload (`handleUpload`), não `put` server-side: o teto é 10 MB e o
// corpo de requisição serverless da Vercel para em 4,5 MB — com o token, o
// arquivo vai do navegador direto ao Blob, e esta rota só autoriza. O token
// nasce restrito: prefixo `referral-payouts/`, tipos de comprovante e 10 MB.

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const PROOF_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: unknown;
    pathname?: unknown;
    contentType?: unknown;
    size?: unknown;
  };

  if (
    body?.action !== "presign" ||
    typeof body.pathname !== "string" ||
    typeof body.contentType !== "string" ||
    typeof body.size !== "number"
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Lança 401/403 → devolve o erro sem emitir URL de upload.
    await requireBackofficePermission("affiliates:manage");

    if (!body.pathname.startsWith("referral-payouts/")) {
      throw new Error("Caminho de comprovante inválido");
    }
    if (
      !ACCEPTED_TYPES.includes(body.contentType) ||
      body.size <= 0 ||
      body.size > PROOF_MAX_SIZE_BYTES
    ) {
      return NextResponse.json(
        { error: "Comprovante inválido" },
        { status: 400 },
      );
    }

    // O vínculo com o pedido acontece depois, quando `decide` grava a URL em
    // `proof_url` — não há nada a registrar aqui. (createMediaUploadUrl sempre
    // adiciona sufixo aleatório, como o addRandomSuffix do Blob fazia.)
    const presigned = await createMediaUploadUrl({
      pathname: body.pathname,
      contentType: body.contentType,
    });
    return NextResponse.json(presigned);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
