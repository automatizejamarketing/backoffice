import { handleMediaLibraryPresign } from "@/lib/media-library/handlers";
import { resolveBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context";
import { createBackofficeMediaLibraryDeps } from "@/lib/media-library/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await resolveBackofficeMediaLibraryContext(id, "marketing:write");
  if (!access.ok) return access.response;
  return handleMediaLibraryPresign(request, access.context, createBackofficeMediaLibraryDeps());
}
