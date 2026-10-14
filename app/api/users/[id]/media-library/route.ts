import { handleMediaLibraryConfirm, handleMediaLibraryList } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Biblioteca de mídias de um cliente (leitura: marketing:read). */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:read");
  if (!access.ok) return access.response;
  return handleMediaLibraryList(request, access.context, createBackofficeMediaLibraryDeps());
}

/** Confirma upload feito pelo admin; o admin fica registrado como autor (marketing:write). */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:write");
  if (!access.ok) return access.response;
  return handleMediaLibraryConfirm(request, access.context, createBackofficeMediaLibraryDeps());
}
