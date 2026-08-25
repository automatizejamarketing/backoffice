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
  // TODO: Implementar a chamada HTTP real para a KeyAPI aqui usando fetch ou axios.
  // Como a documentação não forneceu o endpoint real, este é um mock/stub.
  
  console.log("[KeyAPI] Buscando conteúdos com parâmetros:", JSON.stringify(params));
  
  // Simulando um delay de rede
  await new Promise((resolve) => setTimeout(resolve, 1500));
  
  // Retornando resultados simulados
  return {
    creditsConsumed: 1,
    results: [
      {
        externalId: `mock-${Date.now()}-1`,
        platform: params.platforms?.[0] || "Instagram",
        format: params.formats?.[0] || "Reels",
        profileHandle: params.profiles?.[0] || "@mock_user",
        caption: `Exemplo de conteúdo coletado para ${params.keywords?.[0] || "teste"}!`,
        originalUrl: "https://instagram.com/p/mock1",
        publishedAt: new Date(Date.now() - 86400000), // 1 day ago
        metrics: {
          views: Math.floor(Math.random() * 10000),
          likes: Math.floor(Math.random() * 1000),
          comments: Math.floor(Math.random() * 100),
          shares: Math.floor(Math.random() * 50),
          saves: Math.floor(Math.random() * 20),
        }
      }
    ]
  };
}
