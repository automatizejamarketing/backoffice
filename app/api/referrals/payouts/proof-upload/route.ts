import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireBackofficePermission } from "@/lib/auth/rbac";

// O comprovante do repasse sobe por AQUI, não por URL colada: o operador anexa
// o arquivo (print ou PDF do Pix), ele vai para o Vercel Blob e a URL
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
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Lança 401/403 → handleUpload devolve o erro sem emitir token.
        await requireBackofficePermission("affiliates:manage");

        if (!pathname.startsWith("referral-payouts/")) {
          throw new Error("Caminho de comprovante inválido");
        }

        return {
          allowedContentTypes: ACCEPTED_TYPES,
          maximumSizeInBytes: PROOF_MAX_SIZE_BYTES,
          addRandomSuffix: true,
        };
      },
      // O vínculo com o pedido acontece depois, quando `decide` grava a URL em
      // `proof_url` — não há nada a registrar aqui.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
