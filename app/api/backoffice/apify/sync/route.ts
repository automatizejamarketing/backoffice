import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { MetaAdsResearchProvider } from "@/lib/apify/MetaAdsResearchProvider";
import { db } from "@/lib/db";
import { adCreative, advertiser, adSnapshot } from "@/lib/db/schema";

export async function POST(req: Request) {
  const permission = await requireBackofficePermissionResponse("posts:manage");
  if (!permission.ok) return permission.response;

  try {
    let preset = "";
    let limit = 50;

    try {
      const body = await req.json();
      preset = body.preset || "";
      if (body.limit) limit = Number.parseInt(body.limit, 10);
    } catch {
      // ignore
    }

    const provider = new MetaAdsResearchProvider();
    let normalizedData = [];

    if (preset === "FOOD_BEST_CREATIVES") {
      normalizedData = await provider.runPresetFoodBestCreatives(limit);
    } else {
      normalizedData = await provider.runResearch(
        ["hamburgueria", "pizzaria", "sushi", "restaurante", "doceria", "açai"],
        limit,
      );
    }

    console.log(
      `[Apify Sync] Completed. Normalization yielded ${normalizedData.length} items.`,
    );

    const advertiserCount: Record<string, number> = {};
    const selectedData = [];

    for (const item of normalizedData) {
      const advId = item.facebookPageId || item.advertiserName;
      if (!advertiserCount[advId]) advertiserCount[advId] = 0;

      if (advertiserCount[advId] >= 10) continue;

      selectedData.push(item);
      advertiserCount[advId]++;
    }

    for (const item of selectedData) {
      try {
        let advertiserId: string;
        let advertiserContinuityScore = 50;

        const existingAdvertisers = await db
          .select()
          .from(advertiser)
          .where(eq(advertiser.facebookPageId, item.facebookPageId))
          .limit(1);

        if (existingAdvertisers.length > 0) {
          advertiserId = existingAdvertisers[0].id;
          advertiserContinuityScore =
            existingAdvertisers[0].investmentIntensityScore || 50;
        } else {
          const insertedAdv = await db
            .insert(advertiser)
            .values({
              externalAdvertiserId:
                item.facebookPageId || `unknown-${Date.now()}-${Math.random()}`,
              name: item.advertiserName,
              facebookPageId: item.facebookPageId,
              instagramHandle: item.instagramHandle,
              investmentIntensityScore: 50,
            })
            .returning({ id: advertiser.id });
          advertiserId = insertedAdv[0].id;
        }

        const startDate = item.startDate || new Date();
        const longevityDays = Math.floor(
          (Date.now() - startDate.getTime()) / (1000 * 3600 * 24),
        );
        const isRecent = longevityDays <= 15;

        const advertiserActiveCreativesCount =
          advertiserCount[item.facebookPageId || item.advertiserName] || 1;

        const activeScore = item.isActive ? 100 : 0;
        const longevityScore = Math.min(100, longevityDays * 2);
        const creativeVolumeScore = Math.min(
          100,
          advertiserActiveCreativesCount * 5,
        );
        const recencyScore = isRecent ? 100 : longevityDays < 15 ? 80 : 30;

        const creativeStrengthScore = Math.round(
          activeScore * 0.25 +
            longevityScore * 0.25 +
            creativeVolumeScore * 0.2 +
            recencyScore * 0.15 +
            (item.productRelevanceScore || 0) * 0.15,
        );

        let isPublished = false;
        if (preset === "FOOD_BEST_CREATIVES") {
          if (
            item.category === "FOOD" &&
            (item.productRelevanceScore || 0) >= 50 &&
            creativeStrengthScore >= 50 &&
            item.videoUrl
          ) {
            isPublished = true;
          }
        }

        const existingAds = await db
          .select()
          .from(adCreative)
          .where(eq(adCreative.externalAdId, item.externalAdId))
          .limit(1);

        let currentAdId: string;
        if (existingAds.length > 0) {
          currentAdId = existingAds[0].id;
          await db
            .update(adCreative)
            .set({
              isActive: item.isActive,
              lastSeenAt: new Date(),
              videoUrl: item.videoUrl || existingAds[0].videoUrl,
              thumbnailUrl: item.thumbnailUrl || existingAds[0].thumbnailUrl,
              productRelevanceScore: item.productRelevanceScore,
              creativeStrengthScore,
              advertiserContinuityScore,
              creativeType: item.creativeType,
              isPublished: isPublished || existingAds[0].isPublished,
              updatedAt: new Date(),
            })
            .where(eq(adCreative.id, currentAdId));
        } else {
          const existingByVideo = item.videoUrl
            ? await db
                .select()
                .from(adCreative)
                .where(eq(adCreative.videoUrl, item.videoUrl))
                .limit(1)
            : [];

          if (existingByVideo.length > 0) {
            currentAdId = existingByVideo[0].id;
            await db
              .update(adCreative)
              .set({
                isActive: item.isActive,
                lastSeenAt: new Date(),
                thumbnailUrl: item.thumbnailUrl || existingByVideo[0].thumbnailUrl,
                productRelevanceScore: item.productRelevanceScore,
                creativeStrengthScore,
                advertiserContinuityScore,
                creativeType: item.creativeType,
                isPublished: isPublished || existingByVideo[0].isPublished,
                updatedAt: new Date(),
              })
              .where(eq(adCreative.id, currentAdId));
          } else {
            const insertedAd = await db
              .insert(adCreative)
              .values({
                advertiserId,
                externalAdId: item.externalAdId,
                body: item.body || "",
                headline: item.headline || "",
                description: item.description || "",
                callToAction: item.callToAction || "",
                videoUrl: item.videoUrl,
                thumbnailUrl: item.thumbnailUrl,
                category: item.category,
                subcategory: item.subcategory,
                categoryConfidence: item.categoryConfidence.toString(),
                isActive: item.isActive,
                platforms: item.platforms,
                startDate,
                productRelevanceScore: item.productRelevanceScore,
                creativeStrengthScore,
                advertiserContinuityScore,
                creativeType: item.creativeType,
                isPublished,
              })
              .returning({ id: adCreative.id });
            currentAdId = insertedAd[0].id;
          }
        }

        await db.insert(adSnapshot).values({
          adCreativeId: currentAdId,
          isActive: item.isActive,
          checkedAt: new Date(),
        });
      } catch (itemErr) {
        console.error(
          `[Apify Sync] Error processing item ${item.externalAdId}:`,
          itemErr,
        );
      }
    }

    console.log(
      `[Apify Sync] Finished saving ${normalizedData.length} items to database.`,
    );

    return NextResponse.json({
      success: true,
      message: `Sincronização concluída: ${normalizedData.length} anúncios importados.`,
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
