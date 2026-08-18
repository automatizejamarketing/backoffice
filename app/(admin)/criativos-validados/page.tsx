import { desc, eq } from "drizzle-orm";
import { requirePagePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { adCreative, advertiser } from "@/lib/db/schema";
import { CriativosValidadosClient } from "./client-page";

export const dynamic = "force-dynamic";

export default async function CriativosValidadosPage() {
  await requirePagePermission("posts:manage");

  const items = await db
    .select({
      id: adCreative.id,
      videoUrl: adCreative.videoUrl,
      thumbnailUrl: adCreative.thumbnailUrl,
      headline: adCreative.headline,
      body: adCreative.body,
      category: adCreative.category,
      subcategory: adCreative.subcategory,
      isActive: adCreative.isActive,
      isPublished: adCreative.isPublished,
      firstSeenAt: adCreative.firstSeenAt,
      advertiserName: advertiser.name,
      instagramHandle: advertiser.instagramHandle,
      state: advertiser.state,
      city: advertiser.city,
      score: advertiser.investmentIntensityScore,
      productRelevanceScore: adCreative.productRelevanceScore,
      creativeStrengthScore: adCreative.creativeStrengthScore,
      advertiserContinuityScore: adCreative.advertiserContinuityScore,
      creativeType: adCreative.creativeType,
    })
    .from(adCreative)
    .innerJoin(advertiser, eq(adCreative.advertiserId, advertiser.id))
    .orderBy(desc(adCreative.firstSeenAt))
    .limit(100);

  return <CriativosValidadosClient initialData={items} />;
}

