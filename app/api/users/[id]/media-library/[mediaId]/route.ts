import { handleMediaLibraryDelete } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:write");
  if (!access.ok) return access.response;
  return handleMediaLibraryDelete(mediaId, access.context, createBackofficeMediaLibraryDeps());
}
