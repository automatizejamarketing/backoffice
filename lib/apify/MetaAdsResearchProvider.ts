import { ApifyClient } from "apify-client";
import { FoodCategoryClassifier } from "./FoodCategoryClassifier";
import { FoodCreativeScorer, type CreativeType } from "./FoodCreativeScorer";

export interface ApifyAdItem {
  ad_archive_id?: string;
  advertiser?: {
    ad_library_page_info?: {
      page_info?: {
        page_name?: string;
        page_id?: string;
        ig_username?: string;
      };
    };
  };
  snapshot?: {
    body?: { text?: string } | string;
    title?: string;
    description?: string;
    cta_text?: string;
    videos?: Array<{
      video_hd_url?: string;
      video_sd_url?: string;
      video_preview_image_url?: string;
    }>;
    images?: Array<{
      original_image_url?: string;
      image_url?: string;
    }>;
    cards?: Array<{
      video_hd_url?: string;
      video_sd_url?: string;
      video_preview_image_url?: string;
      image_url?: string;
      title?: string;
      cta_text?: string;
    }>;
  };
  publisher_platforms?: string[];
  start_date?: number | string;
  is_active?: boolean;
}

export interface AdCreativeNormalized {
  externalAdId: string;
  advertiserName: string;
  facebookPageId: string;
  instagramHandle?: string;
  body: string;
  headline: string;
  description: string;
  callToAction: string;
  videoUrl: string;
  thumbnailUrl: string;
  platforms: string[];
  startDate?: Date;
  isActive: boolean;
  category: string;
  subcategory: string;
  categoryConfidence: number;
  productRelevanceScore: number;
  creativeType: CreativeType;
}

export class MetaAdsResearchProvider {
  private apifyToken: string;
  private actorId = "NhPFybfZbHGsFcbuG";
  private client: ApifyClient;

  constructor(token?: string) {
    this.apifyToken =
      token ||
      process.env.APIFY_API_KEY ||
      process.env.APIFY_API_TOKEN ||
      process.env.APIFY_TOKEN ||
      "";
    this.client = new ApifyClient({
      token: this.apifyToken,
    });
  }

  async runResearch(
    searchTerms: string[],
    targetResults: number = 20,
  ): Promise<AdCreativeNormalized[]> {
    if (!this.apifyToken) {
      console.warn("Apify token not configured.");
      return [];
    }

    console.log(
      `[MetaAdsResearchProvider] Starting Apify run for terms: ${searchTerms.join(", ")} with target ${targetResults}`,
    );

    try {
      let allItems: ApifyAdItem[] = [];

      const termsToSearch = searchTerms.slice(0, 4);
      const maxAdsPerTerm = Math.max(10, Math.ceil(targetResults / termsToSearch.length));

      for (const term of termsToSearch) {
        const input = {
          startUrl: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q=${encodeURIComponent(term)}`,
          maxAds: maxAdsPerTerm,
          extractDetails: false,
        };

        console.log(
          `[MetaAdsResearchProvider] Calling actor for term: ${term} (target: ${maxAdsPerTerm})`,
        );
        const run = await this.client.actor(this.actorId).call(input);

        console.log(
          `[MetaAdsResearchProvider] Apify run completed with ID: ${run.id}. Fetching dataset...`,
        );
        const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

        console.log(
          `[MetaAdsResearchProvider] Fetched ${items.length} items for term ${term}.`,
        );
        allItems = allItems.concat(items as any as ApifyAdItem[]);
      }

      return this.normalizeData(allItems);
    } catch (error) {
      console.error("[MetaAdsResearchProvider] Error calling Apify:", error);
      return [];
    }
  }

  async runPresetFoodBestCreatives(
    targetResults: number = 200,
  ): Promise<AdCreativeNormalized[]> {
    if (!this.apifyToken) {
      console.warn("Apify token not configured.");
      return [];
    }

    console.log(
      `[MetaAdsResearchProvider] Starting FOOD_BEST_CREATIVES preset with target ${targetResults}...`,
    );

    const termsConfig = [
      { term: "hamburgueria", weight: 30 },
      { term: "pizzaria", weight: 25 },
      { term: "pastelaria", weight: 20 },
      { term: "hot dog", weight: 15 },
      { term: "açaí", weight: 15 },
      { term: "sushi", weight: 15 },
      { term: "restaurante", weight: 20 },
      { term: "lanchonete", weight: 15 },
      { term: "cafeteria", weight: 10 },
      { term: "doceria", weight: 10 },
      { term: "padaria", weight: 10 },
      { term: "churrascaria", weight: 15 },
    ];

    try {
      let allItems: ApifyAdItem[] = [];

      for (const config of termsConfig) {
        const maxAds = Math.max(10, Math.ceil((config.weight / 200) * targetResults));
        const input = {
          startUrl: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&q=${encodeURIComponent(config.term)}`,
          maxAds,
          extractDetails: false,
        };

        console.log(
          `[MetaAdsResearchProvider] Preset: Calling actor for term: ${config.term} (target: ${maxAds})`,
        );
        const run = await this.client.actor(this.actorId).call(input);

        console.log(
          `[MetaAdsResearchProvider] Preset: Run completed with ID: ${run.id}. Fetching dataset...`,
        );
        const { items } = await this.client.dataset(run.defaultDatasetId).listItems();

        console.log(
          `[MetaAdsResearchProvider] Preset: Fetched ${items.length} items for term ${config.term}.`,
        );
        allItems = allItems.concat(items as any as ApifyAdItem[]);
      }

      return this.normalizeData(allItems);
    } catch (error) {
      console.error("[MetaAdsResearchProvider] Error running preset:", error);
      return [];
    }
  }

  normalizeData(rawData: ApifyAdItem[]): AdCreativeNormalized[] {
    return rawData
      .map((item) => {
        const pageName =
          item.advertiser?.ad_library_page_info?.page_info?.page_name || "Desconhecido";
        const bodyObj = item.snapshot?.body;
        const bodyText =
          typeof bodyObj === "string" ? bodyObj : (bodyObj?.text || "");
        const titleText = item.snapshot?.title || item.snapshot?.cards?.[0]?.title || "";
        const descriptionText = item.snapshot?.description || "";

        const classification = FoodCategoryClassifier.classify([
          pageName,
          bodyText,
          titleText,
          descriptionText,
        ]);

        const textDataForScoring = [bodyText, titleText, descriptionText];
        const productRelevanceScore = FoodCreativeScorer.calculateProductRelevance(
          textDataForScoring,
          classification.category,
          classification.subcategory,
        );
        const creativeType = FoodCreativeScorer.classifyCreativeType(textDataForScoring);

        const videoUrl =
          item.snapshot?.videos?.[0]?.video_hd_url ||
          item.snapshot?.videos?.[0]?.video_sd_url ||
          item.snapshot?.cards?.[0]?.video_hd_url ||
          item.snapshot?.cards?.[0]?.video_sd_url ||
          "";

        const thumbnailUrl =
          item.snapshot?.images?.[0]?.original_image_url ||
          item.snapshot?.images?.[0]?.image_url ||
          item.snapshot?.videos?.[0]?.video_preview_image_url ||
          item.snapshot?.cards?.[0]?.image_url ||
          item.snapshot?.cards?.[0]?.video_preview_image_url ||
          "";

        let startDate: Date | undefined;
        if (item.start_date) {
          startDate = new Date(
            typeof item.start_date === "number"
              ? item.start_date * 1000
              : item.start_date,
          );
        }

        return {
          externalAdId: item.ad_archive_id || `unknown-${Date.now()}-${Math.random()}`,
          advertiserName: pageName,
          facebookPageId: item.advertiser?.ad_library_page_info?.page_info?.page_id || "",
          instagramHandle: item.advertiser?.ad_library_page_info?.page_info?.ig_username,
          body: bodyText,
          headline: titleText,
          description: descriptionText,
          callToAction: item.snapshot?.cta_text || item.snapshot?.cards?.[0]?.cta_text || "",
          videoUrl,
          thumbnailUrl,
          platforms: item.publisher_platforms || [],
          startDate,
          isActive: item.is_active ?? true,
          category: classification.category,
          subcategory: classification.subcategory,
          categoryConfidence: classification.categoryConfidence,
          productRelevanceScore,
          creativeType,
        };
      })
      .filter((item) => item.videoUrl && item.videoUrl.trim() !== "");
  }
}
