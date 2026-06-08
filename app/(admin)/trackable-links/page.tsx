import { requirePagePermission } from "@/lib/auth/rbac";
import { listTrackableLinksWithCounts } from "@/lib/trackable-links/queries";
import { TrackableLinksClient } from "./trackable-links-client";

// Query-heavy aggregate page — keep dynamic to avoid Vercel build timeouts.
export const dynamic = "force-dynamic";

export default async function TrackableLinksPage() {
  await requirePagePermission("trackable-links:manage");

  const links = await listTrackableLinksWithCounts();
  // Trackable links point at the FRONTEND app (where the ?lr capture + signup
  // happen), NOT the backoffice. Read at RUNTIME (server-side) from FRONTEND_URL
  // — intentionally NOT a NEXT_PUBLIC_ var, so the value is read at request time
  // (this page is force-dynamic) instead of being inlined at build, and always
  // reflects the deploy's current env. Set it per environment in the backoffice
  // deploy (Vercel): staging -> frontend staging URL, prod -> frontend prod URL.
  // Falls back to localhost:3000 for local dev (frontend runs on port 3000).
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  const initialLinks = links.map((l) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    clicks: l.clicks,
    signups: l.signups,
    createdAt: l.createdAt.toISOString(),
  }));

  return (
    <TrackableLinksClient initialLinks={initialLinks} frontendUrl={frontendUrl} />
  );
}
