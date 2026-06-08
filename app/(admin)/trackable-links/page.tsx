import { requirePagePermission } from "@/lib/auth/rbac";
import { listTrackableLinksWithCounts } from "@/lib/trackable-links/queries";
import { TrackableLinksClient } from "./trackable-links-client";

// Query-heavy aggregate page — keep dynamic to avoid Vercel build timeouts.
export const dynamic = "force-dynamic";

export default async function TrackableLinksPage() {
  await requirePagePermission("trackable-links:manage");

  const links = await listTrackableLinksWithCounts();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
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

  return <TrackableLinksClient initialLinks={initialLinks} appUrl={appUrl} />;
}
