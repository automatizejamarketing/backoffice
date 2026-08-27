/**
 * Serviço de Integração com a KeyAPI.
 * O frontend NUNCA deve chamar isso. Apenas o backend do Backoffice ou Cron Jobs.
 */

export interface KeyApiSearchParams {
  keywords?: string[];
  hashtags?: string[];
  profiles?: string[];
  platforms?: string[];
  formats?: string[];
  country?: string;
  state?: string;
  city?: string;
  maxResults?: number;
}

export interface KeyApiContentResult {
  externalId: string;
  platform: string;
  format: string;
  profileHandle: string;
  caption: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  originalUrl?: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    profileFollowers?: number;
  };
  publishedAt?: Date;
}

export interface KeyApiSearchResult {
  results: KeyApiContentResult[];
  creditsConsumed: number;
  error?: string;
}

export async function searchContentOnKeyApi(params: KeyApiSearchParams): Promise<KeyApiSearchResult> {
  const apiKey = process.env.KEYAPI_TOKEN || "sk_live_-Vc6LbPKX43J-8uDM1m8k9jWSiFv1FPV";
  const url = new URL("https://api.keyapi.ai/v1/tiktok/video/search");
  
  if (params.keywords && params.keywords.length > 0) {
    url.searchParams.append("keyword", params.keywords[0]);
  } else if (params.hashtags && params.hashtags.length > 0) {
    url.searchParams.append("keyword", params.hashtags[0]);
  } else {
    url.searchParams.append("keyword", "marketing"); // default fallback
  }

  // A API exige a região (ex: BR, US)
  url.searchParams.append("region", params.country || "BR");
  
  console.log(`[KeyAPI] Buscando conteúdos: ${url.toString()}`);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`KeyAPI error: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.code !== 0) {
      throw new Error(data.message || "Erro na KeyAPI");
    }

    const awemeList = (data.data?.aweme_list?.length > 0 
      ? data.data.aweme_list 
      : data.data?.search_item_list?.map((item: any) => item.aweme_info)) || [];
    
    const results: KeyApiContentResult[] = awemeList.slice(0, params.maxResults || 20).map((aweme: any) => {
      const stats = aweme.statistics || {};
      const author = aweme.author || {};
      
      return {
        externalId: aweme.aweme_id,
        platform: "TikTok",
        format: "Vídeo",
        profileHandle: author.unique_id || author.nickname || "user",
        caption: aweme.desc || "",
        thumbnailUrl: aweme.video?.cover?.url_list?.[0] || "",
        previewUrl: aweme.video?.play_addr?.url_list?.[0] || "",
        originalUrl: `https://www.tiktok.com/@${author.unique_id}/video/${aweme.aweme_id}`,
        publishedAt: new Date(aweme.create_time * 1000),
        metrics: {
          views: stats.play_count || 0,
          likes: stats.digg_count || 0,
          comments: stats.comment_count || 0,
          shares: stats.share_count || 0,
          saves: stats.collect_count || 0,
          profileFollowers: author.follower_count || 0,
        }
      };
    });

    return {
      creditsConsumed: 1,
      results
    };
  } catch (error: any) {
    console.error("[KeyAPI] Erro:", error.message);
    return {
      creditsConsumed: 0,
      results: [],
      error: error.message
    };
  }
}
