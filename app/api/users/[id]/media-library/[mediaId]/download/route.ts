import { handleMediaLibraryDownload } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:read");
  if (!access.ok) return access.response;
  return handleMediaLibraryDownload(request, mediaId, access.context, createBackofficeMediaLibraryDeps());
}
