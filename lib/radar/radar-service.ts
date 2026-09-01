import { searchContentOnKeyApi, KeyApiSearchParams } from "./keyapi-service";
import { 
  getRadarConfigurationById, 
  createRadarCollectionRun, 
  updateRadarCollectionRun, 
  upsertRadarContent, 
  addRadarContentSnapshot 
} from "../db/radar-queries";

export async function calculateTrendScore(metrics: any): Promise<number> {
  // Mock logic: views + (likes * 2) + (comments * 5) + (shares * 10)
  const views = metrics.views || 0;
  const likes = metrics.likes || 0;
  const comments = metrics.comments || 0;
  const shares = metrics.shares || 0;
  
  return views + (likes * 2) + (comments * 5) + (shares * 10);
}

export async function executeRadarConfiguration(configId: string, executedBy?: string, isManual = false) {
  const config = await getRadarConfigurationById(configId);
  if (!config) throw new Error("Configuração não encontrada");
  
  // 1. Criar o registro de Run (Pendente/Processando)
  const run = await createRadarCollectionRun({
    configurationId: config.id,
    origin: isManual ? "manual" : "scheduled",
    status: "processing",
    executedBy: executedBy || null,
    startedAt: new Date(),
  });
  
  try {
    // 2. Mapear parametros da KeyAPI
    const searchParams: KeyApiSearchParams = {
      keywords: config.keywords as string[] || [],
      hashtags: config.hashtags as string[] || [],
      profiles: config.profiles as string[] || [],
      platforms: config.platforms as string[] || [],
      formats: config.formats as string[] || [],
      country: config.country || undefined,
      state: config.state || undefined,
      city: config.city || undefined,
      maxResults: config.maxResults || 50,
    };
    
    // 3. Buscar na KeyAPI
    const apiResult = await searchContentOnKeyApi(searchParams);
    
    if (apiResult.error) {
      throw new Error(`Erro na KeyAPI: ${apiResult.error}`);
    }
    
    let itemsNew = 0;
    let itemsUpdated = 0;
    
    // 4. Normalizar e Salvar
    for (const item of apiResult.results) {
      const trendScore = await calculateTrendScore(item.metrics);
      const isApprovedAuto = !config.requiresApproval && (config.minScore === null || trendScore >= (config.minScore || 0));
      
      const { content, isNew } = await upsertRadarContent({
        externalId: item.externalId,
        platform: item.platform,
        format: item.format,
        profileHandle: item.profileHandle,
        caption: item.caption,
        thumbnailUrl: item.thumbnailUrl,
        previewUrl: item.previewUrl,
        originalUrl: item.originalUrl,
        currentMetrics: item.metrics,
        trendScore: trendScore.toString(),
        niche: config.niche,
        subNiche: config.subNiche,
        location: [config.city, config.state, config.country].filter(Boolean).join(", ") || null,
        publishedAt: item.publishedAt,
        publicationStatus: isApprovedAuto ? 'published' : 'pending',
      });
      
      if (isNew) itemsNew++;
      else itemsUpdated++;
      
      // Salvar snapshot
      await addRadarContentSnapshot({
        contentId: content.id,
        views: item.metrics.views,
        likes: item.metrics.likes,
        comments: item.metrics.comments,
        shares: item.metrics.shares,
        saves: item.metrics.saves,
        profileFollowers: item.metrics.profileFollowers,
      });
    }
    
    // 5. Atualizar Run
    await updateRadarCollectionRun(run.id, {
      status: "completed",
      completedAt: new Date(),
      itemsFound: apiResult.results.length,
      itemsNew,
      itemsUpdated,
      creditsConsumed: apiResult.creditsConsumed,
    });
    
    return { success: true, itemsNew, itemsUpdated };
    
  } catch (error: any) {
    // Falha
    await updateRadarCollectionRun(run.id, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: error.message || "Erro desconhecido",
    });
    
    return { success: false, error: error.message };
  }
}
