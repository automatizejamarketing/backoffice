import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "./index";
import {
  adsetEditLog,
  aiGeneratedText,
  aiUsageLog,
  backofficeGeneratedPost,
  chat,
  company,
  foodServicePostCriativo,
  foodServicePostDoPrato,
  foodServiceStoryTurbo,
  generatedImage,
  generatedImageVersion,
  genericGeneratePost,
  metaBusinessAccount,
  post,
  referenceImage,
  user,
  userCompany,
  type AdSetTargetingData,
} from "./schema";

// Get all users with their usage summary
export async function getAllUsersWithUsage() {
  const users = await db.select().from(user).orderBy(desc(user.id));

  const usersWithUsage = await Promise.all(
    users.map(async (u) => {
      // Get chat count
      const [chatCount] = await db
        .select({ count: count() })
        .from(chat)
        .where(eq(chat.userId, u.id));

      // Get post count
      const [postCount] = await db
        .select({ count: count() })
        .from(post)
        .where(eq(post.userId, u.id));

      // Get AI usage summary
      const [usageSummary] = await db
        .select({
          totalCost: sql<string>`COALESCE(SUM(${aiUsageLog.cost}), 0)`,
          totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`,
          requestCount: count(),
        })
        .from(aiUsageLog)
        .where(eq(aiUsageLog.userId, u.id));

      // Get company info
      const [companyInfo] = await db
        .select({
          companyId: userCompany.companyId,
          companyName: company.name,
          onboardingCompleted: company.onboardingCompleted,
        })
        .from(userCompany)
        .leftJoin(company, eq(userCompany.companyId, company.id))
        .where(eq(userCompany.userId, u.id))
        .limit(1);

      return {
        ...u,
        chatCount: chatCount?.count ?? 0,
        postCount: postCount?.count ?? 0,
        totalCost: Number.parseFloat(usageSummary?.totalCost ?? "0"),
        totalTokens: usageSummary?.totalTokens ?? 0,
        requestCount: usageSummary?.requestCount ?? 0,
        companyName: companyInfo?.companyName ?? null,
        onboardingCompleted: companyInfo?.onboardingCompleted ?? false,
      };
    })
  );

  return usersWithUsage;
}

// Get single user with detailed usage
export async function getUserWithDetailedUsage(userId: string) {
  const [foundUser] = await db.select().from(user).where(eq(user.id, userId));

  if (!foundUser) {
    return null;
  }

  // Get chat count
  const [chatCount] = await db
    .select({ count: count() })
    .from(chat)
    .where(eq(chat.userId, userId));

  // Get post count
  const [postCount] = await db
    .select({ count: count() })
    .from(post)
    .where(eq(post.userId, userId));

  // Get recent usage logs
  const recentUsage = await db
    .select()
    .from(aiUsageLog)
    .where(eq(aiUsageLog.userId, userId))
    .orderBy(desc(aiUsageLog.createdAt))
    .limit(50);

  // Get usage breakdown by model (used as "action" breakdown since action column doesn't exist)
  const usageByAction = await db
    .select({
      action: aiUsageLog.modelId,
      totalCost: sql<string>`SUM(${aiUsageLog.cost})`,
      totalTokens: sql<number>`SUM(${aiUsageLog.totalTokens})`,
      requestCount: count(),
    })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.userId, userId))
    .groupBy(aiUsageLog.modelId);

  // Get usage breakdown by model
  const usageByModel = await db
    .select({
      modelId: aiUsageLog.modelId,
      provider: aiUsageLog.provider,
      totalCost: sql<string>`SUM(${aiUsageLog.cost})`,
      totalTokens: sql<number>`SUM(${aiUsageLog.totalTokens})`,
      requestCount: count(),
    })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.userId, userId))
    .groupBy(aiUsageLog.modelId, aiUsageLog.provider);

  // Get company info
  const [companyInfo] = await db
    .select({
      companyId: userCompany.companyId,
      companyName: company.name,
      onboardingCompleted: company.onboardingCompleted,
    })
    .from(userCompany)
    .leftJoin(company, eq(userCompany.companyId, company.id))
    .where(eq(userCompany.userId, userId))
    .limit(1);

  // Calculate totals
  const totalCost = recentUsage.reduce(
    (sum, log) => sum + Number.parseFloat(log.cost),
    0
  );
  const totalTokens = recentUsage.reduce((sum, log) => sum + log.totalTokens, 0);

  return {
    ...foundUser,
    chatCount: chatCount?.count ?? 0,
    postCount: postCount?.count ?? 0,
    totalCost,
    totalTokens,
    requestCount: recentUsage.length,
    recentUsage,
    usageByAction: usageByAction.map((u) => ({
      ...u,
      totalCost: Number.parseFloat(u.totalCost ?? "0"),
    })),
    usageByModel: usageByModel.map((u) => ({
      ...u,
      totalCost: Number.parseFloat(u.totalCost ?? "0"),
    })),
    companyName: companyInfo?.companyName ?? null,
    onboardingCompleted: companyInfo?.onboardingCompleted ?? false,
  };
}

// Get dashboard overview stats
export async function getDashboardStats() {
  // Total users
  const [userCount] = await db.select({ count: count() }).from(user);

  // Active users in last 7 days (users with AI usage)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const activeUsers = await db
    .selectDistinct({ userId: aiUsageLog.userId })
    .from(aiUsageLog)
    .where(gte(aiUsageLog.createdAt, sevenDaysAgo));

  // Total AI cost
  const [totalUsage] = await db
    .select({
      totalCost: sql<string>`COALESCE(SUM(${aiUsageLog.cost}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`,
      totalRequests: count(),
    })
    .from(aiUsageLog);

  // Total chats
  const [chatCount] = await db.select({ count: count() }).from(chat);

  // Total posts
  const [postCount] = await db.select({ count: count() }).from(post);

  // Companies with completed onboarding
  const [completedOnboarding] = await db
    .select({ count: count() })
    .from(company)
    .where(eq(company.onboardingCompleted, true));

  return {
    totalUsers: userCount?.count ?? 0,
    activeUsersLast7Days: activeUsers.length,
    totalCost: Number.parseFloat(totalUsage?.totalCost ?? "0"),
    totalTokens: totalUsage?.totalTokens ?? 0,
    totalRequests: totalUsage?.totalRequests ?? 0,
    totalChats: chatCount?.count ?? 0,
    totalPosts: postCount?.count ?? 0,
    completedOnboarding: completedOnboarding?.count ?? 0,
  };
}

// Search users by email
export async function searchUsersByEmail(query: string) {
  return db
    .select()
    .from(user)
    .where(ilike(user.email, `%${query}%`))
    .limit(10);
}

// Get user's Meta Business Account
export async function getUserMetaBusinessAccount(userId: string) {
  const [account] = await db
    .select()
    .from(metaBusinessAccount)
    .where(eq(metaBusinessAccount.userId, userId))
    .limit(1);
  return account ?? null;
}

// ================================
// Users with Posts (based on ai_generated_images)
// ================================

export async function getUsersWithPosts(options?: {
  email?: string;
  page?: number;
  limit?: number;
}) {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [
    isNull(generatedImage.deletedAt),
    isNull(generatedImageVersion.parentVersionId),
  ];
  if (options?.email) {
    conditions.push(ilike(user.email, `%${options.email}%`));
  }

  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      imageUrl: user.image_url,
      postCount: count(generatedImage.id),
      latestPostAt: sql<Date>`MAX(${generatedImage.createdAt})`,
    })
    .from(user)
    .innerJoin(generatedImage, eq(user.id, generatedImage.userId))
    .innerJoin(
      generatedImageVersion,
      eq(generatedImage.id, generatedImageVersion.generatedImageId),
    )
    .where(and(...conditions))
    .groupBy(user.id, user.email, user.image_url)
    .orderBy(desc(sql`MAX(${generatedImage.createdAt})`))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${user.id})` })
    .from(user)
    .innerJoin(generatedImage, eq(user.id, generatedImage.userId))
    .innerJoin(
      generatedImageVersion,
      eq(generatedImage.id, generatedImageVersion.generatedImageId),
    )
    .where(and(...conditions));

  const usersWithCompany = await Promise.all(
    rows.map(async (row) => {
      const [companyInfo] = await db
        .select({ companyName: company.name })
        .from(userCompany)
        .leftJoin(company, eq(userCompany.companyId, company.id))
        .where(eq(userCompany.userId, row.id))
        .limit(1);

      return {
        ...row,
        companyName: companyInfo?.companyName ?? null,
      };
    })
  );

  return { users: usersWithCompany, total: totalResult?.count ?? 0, page, limit };
}

// ================================
// Generated Image Query Functions (user posts)
// ================================

export async function getAllUserGeneratedImages(options?: {
  userId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}) {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [
    isNull(generatedImage.deletedAt),
    isNull(generatedImageVersion.parentVersionId),
  ];
  if (options?.userId) conditions.push(eq(generatedImage.userId, options.userId));
  if (options?.status) conditions.push(eq(generatedImage.status, options.status));
  if (options?.search) {
    const term = `%${options.search}%`;
    conditions.push(ilike(generatedImage.prompt, term));
  }

  const images = await db
    .select({
      id: generatedImage.id,
      userId: generatedImage.userId,
      userEmail: user.email,
      userImage: user.image_url,
      prompt: generatedImage.prompt,
      aspectRatio: generatedImage.aspectRatio,
      width: generatedImage.width,
      height: generatedImage.height,
      imageUrl: generatedImage.publicImageUrl,
      status: generatedImage.status,
      createdAt: generatedImage.createdAt,
      updatedAt: generatedImage.updatedAt,
    })
    .from(generatedImageVersion)
    .innerJoin(generatedImage, eq(generatedImageVersion.generatedImageId, generatedImage.id))
    .innerJoin(user, eq(generatedImage.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(generatedImage.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: count() })
    .from(generatedImageVersion)
    .innerJoin(generatedImage, eq(generatedImageVersion.generatedImageId, generatedImage.id))
    .where(and(...conditions));

  if (images.length === 0) {
    return { posts: [], total: 0, page, limit };
  }

  const rootIds = images.map((img) => img.id);
  const latestVersions = await db
    .select({
      sourceId: generatedImageVersion.sourceAiGeneratedImageId,
      imageUrl: generatedImage.publicImageUrl,
    })
    .from(generatedImageVersion)
    .innerJoin(generatedImage, eq(generatedImageVersion.generatedImageId, generatedImage.id))
    .where(
      and(
        inArray(generatedImageVersion.sourceAiGeneratedImageId, rootIds),
        isNull(generatedImage.deletedAt),
      )
    )
    .orderBy(desc(generatedImageVersion.versionNumber));

  const latestImageMap = new Map<string, string | null>();
  for (const v of latestVersions) {
    if (!latestImageMap.has(v.sourceId)) {
      latestImageMap.set(v.sourceId, v.imageUrl);
    }
  }

  const captionRows = await db
    .select({
      imageId: genericGeneratePost.postImageId,
      caption: aiGeneratedText.text,
    })
    .from(genericGeneratePost)
    .leftJoin(aiGeneratedText, eq(genericGeneratePost.captionTextId, aiGeneratedText.id))
    .where(
      and(
        inArray(genericGeneratePost.postImageId, rootIds),
        isNull(genericGeneratePost.deletedAt),
      )
    );

  const captionMap = new Map<string, string | null>();
  for (const c of captionRows) {
    captionMap.set(c.imageId, c.caption);
  }

  const posts = images.map((img) => ({
    ...img,
    currentImageUrl: latestImageMap.get(img.id) ?? img.imageUrl,
    caption: captionMap.get(img.id) ?? null,
  }));

  return { posts, total: totalResult?.count ?? 0, page, limit };
}

export type GeneratedImageDetails = {
  id: string;
  userId: string;
  userEmail: string;
  userImage: string | null;
  companyName: string | null;
  prompt: string;
  aspectRatio: string;
  width: number;
  height: number;
  imageUrl: string | null;
  currentImageUrl: string | null;
  status: string;
  caption: string | null;
  referenceImages: { id: string; imageUrl: string }[];
  createdAt: Date;
};

export async function getGeneratedImageDetails(
  imageId: string
): Promise<GeneratedImageDetails | null> {
  const [found] = await db
    .select({
      id: generatedImage.id,
      userId: generatedImage.userId,
      userEmail: user.email,
      userImage: user.image_url,
      prompt: generatedImage.prompt,
      aspectRatio: generatedImage.aspectRatio,
      width: generatedImage.width,
      height: generatedImage.height,
      imageUrl: generatedImage.publicImageUrl,
      status: generatedImage.status,
      createdAt: generatedImage.createdAt,
    })
    .from(generatedImage)
    .innerJoin(user, eq(generatedImage.userId, user.id))
    .where(eq(generatedImage.id, imageId));

  if (!found) return null;

  const [companyInfo] = await db
    .select({ companyName: company.name })
    .from(userCompany)
    .leftJoin(company, eq(userCompany.companyId, company.id))
    .where(eq(userCompany.userId, found.userId))
    .limit(1);

  const [latestVersion] = await db
    .select({ imageUrl: generatedImage.publicImageUrl })
    .from(generatedImageVersion)
    .innerJoin(generatedImage, eq(generatedImageVersion.generatedImageId, generatedImage.id))
    .where(
      and(
        eq(generatedImageVersion.sourceAiGeneratedImageId, imageId),
        isNull(generatedImage.deletedAt),
      )
    )
    .orderBy(desc(generatedImageVersion.versionNumber))
    .limit(1);

  const refs = await db
    .select({ id: referenceImage.id, imageUrl: referenceImage.imageUrl })
    .from(referenceImage)
    .where(eq(referenceImage.aiGeneratedImageId, imageId));

  let caption: string | null = null;
  const [genericPost] = await db
    .select({ captionTextId: genericGeneratePost.captionTextId })
    .from(genericGeneratePost)
    .where(
      and(
        eq(genericGeneratePost.postImageId, imageId),
        isNull(genericGeneratePost.deletedAt),
      )
    )
    .limit(1);

  if (genericPost?.captionTextId) {
    const [ct] = await db
      .select()
      .from(aiGeneratedText)
      .where(eq(aiGeneratedText.id, genericPost.captionTextId));
    caption = ct?.text ?? null;
  }

  return {
    ...found,
    companyName: companyInfo?.companyName ?? null,
    currentImageUrl: latestVersion?.imageUrl ?? found.imageUrl,
    caption,
    referenceImages: refs,
  };
}

export async function getBackofficeGeneratedPosts(options?: {
  page?: number;
  limit?: number;
}) {
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 20;
  const offset = (page - 1) * limit;

  const adminUser = user;

  const posts = await db
    .select({
      id: backofficeGeneratedPost.id,
      backofficeUserId: backofficeGeneratedPost.backofficeUserId,
      backofficeUserEmail: sql<string>`(SELECT email FROM users WHERE id = ${backofficeGeneratedPost.backofficeUserId})`,
      targetUserId: backofficeGeneratedPost.targetUserId,
      targetUserEmail: sql<string>`(SELECT email FROM users WHERE id = ${backofficeGeneratedPost.targetUserId})`,
      sourceUserGeneratedImageId: backofficeGeneratedPost.sourceUserGeneratedImageId,
      sourceBackofficePostId: backofficeGeneratedPost.sourceBackofficePostId,
      prompt: backofficeGeneratedPost.prompt,
      referenceImageUrls: backofficeGeneratedPost.referenceImageUrls,
      aspectRatio: backofficeGeneratedPost.aspectRatio,
      status: backofficeGeneratedPost.status,
      notes: backofficeGeneratedPost.notes,
      createdAt: backofficeGeneratedPost.createdAt,
      generatedImageUrl: generatedImage.publicImageUrl,
      captionText: aiGeneratedText.text,
    })
    .from(backofficeGeneratedPost)
    .leftJoin(
      generatedImage,
      eq(backofficeGeneratedPost.generatedImageId, generatedImage.id)
    )
    .leftJoin(
      aiGeneratedText,
      eq(backofficeGeneratedPost.captionTextId, aiGeneratedText.id)
    )
    .where(isNull(backofficeGeneratedPost.deletedAt))
    .orderBy(desc(backofficeGeneratedPost.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: count() })
    .from(backofficeGeneratedPost)
    .where(isNull(backofficeGeneratedPost.deletedAt));

  return { posts, total: totalResult?.count ?? 0, page, limit };
}

export async function getBackofficePostDetails(postId: string) {
  const [bp] = await db
    .select()
    .from(backofficeGeneratedPost)
    .where(eq(backofficeGeneratedPost.id, postId));

  if (!bp) return null;

  const [admin] = await db
    .select()
    .from(user)
    .where(eq(user.id, bp.backofficeUserId));
  const [target] = await db
    .select()
    .from(user)
    .where(eq(user.id, bp.targetUserId));

  let imageUrl: string | null = null;
  let imagePrompt: string | null = null;
  if (bp.generatedImageId) {
    const [gi] = await db
      .select()
      .from(generatedImage)
      .where(eq(generatedImage.id, bp.generatedImageId));
    imageUrl = gi?.publicImageUrl ?? gi?.image ?? null;
    imagePrompt = gi?.prompt ?? null;
  }

  let captionText: string | null = null;
  if (bp.captionTextId) {
    const [ct] = await db
      .select()
      .from(aiGeneratedText)
      .where(eq(aiGeneratedText.id, bp.captionTextId));
    captionText = ct?.text ?? null;
  }

  let sourcePost: GeneratedImageDetails | null = null;
  if (bp.sourceUserGeneratedImageId) {
    sourcePost = await getGeneratedImageDetails(bp.sourceUserGeneratedImageId);
  }

  return {
    ...bp,
    backofficeUserEmail: admin?.email ?? null,
    targetUserEmail: target?.email ?? null,
    generatedImageUrl: imageUrl,
    generatedImagePrompt: imagePrompt,
    captionText,
    sourcePost,
  };
}

export async function createBackofficeGeneratedPost(data: {
  backofficeUserId: string;
  targetUserId: string;
  sourceUserGeneratedImageId?: string;
  sourceBackofficePostId?: string;
  prompt: string;
  generatedImageId?: string;
  captionTextId?: string;
  referenceImageUrls?: string[];
  aspectRatio?: string;
  status?: string;
  notes?: string;
}) {
  const [record] = await db
    .insert(backofficeGeneratedPost)
    .values({
      backofficeUserId: data.backofficeUserId,
      targetUserId: data.targetUserId,
      sourceUserGeneratedImageId: data.sourceUserGeneratedImageId,
      sourceBackofficePostId: data.sourceBackofficePostId,
      prompt: data.prompt,
      generatedImageId: data.generatedImageId,
      captionTextId: data.captionTextId,
      referenceImageUrls: data.referenceImageUrls ?? [],
      aspectRatio: data.aspectRatio ?? "1:1",
      status: data.status ?? "generating",
      notes: data.notes,
    })
    .returning();
  return record;
}

export async function updateBackofficeGeneratedPost(
  id: string,
  data: Partial<{
    generatedImageId: string;
    captionTextId: string;
    status: string;
    notes: string;
  }>
) {
  const [updated] = await db
    .update(backofficeGeneratedPost)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(backofficeGeneratedPost.id, id))
    .returning();
  return updated;
}

export async function getPostPerformanceStats(userId?: string) {
  const imgConditions = userId
    ? and(
        isNull(generatedImage.deletedAt),
        eq(generatedImage.userId, userId),
        isNull(generatedImageVersion.parentVersionId),
      )
    : and(
        isNull(generatedImage.deletedAt),
        isNull(generatedImageVersion.parentVersionId),
      );

  const [totalPosts] = await db
    .select({ count: count() })
    .from(generatedImageVersion)
    .innerJoin(generatedImage, eq(generatedImageVersion.generatedImageId, generatedImage.id))
    .where(imgConditions);

  const postsByType = await db
    .select({
      postType: generatedImage.aspectRatio,
      count: count(),
    })
    .from(generatedImageVersion)
    .innerJoin(generatedImage, eq(generatedImageVersion.generatedImageId, generatedImage.id))
    .where(imgConditions)
    .groupBy(generatedImage.aspectRatio);

  const usageConditions = userId ? eq(aiUsageLog.userId, userId) : undefined;

  const [aiCostTotal] = await db
    .select({
      totalCost: sql<string>`COALESCE(SUM(${aiUsageLog.cost}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`,
      avgDuration: sql<number>`COALESCE(AVG(${aiUsageLog.durationMs}), 0)`,
      totalRequests: count(),
    })
    .from(aiUsageLog)
    .where(usageConditions);

  const [backofficePostCount] = await db
    .select({ count: count() })
    .from(backofficeGeneratedPost)
    .where(isNull(backofficeGeneratedPost.deletedAt));

  const costByUser = await db
    .select({
      userId: aiUsageLog.userId,
      email: user.email,
      totalCost: sql<string>`SUM(${aiUsageLog.cost})`,
      totalTokens: sql<number>`SUM(${aiUsageLog.totalTokens})`,
      requestCount: count(),
    })
    .from(aiUsageLog)
    .innerJoin(user, eq(aiUsageLog.userId, user.id))
    .groupBy(aiUsageLog.userId, user.email)
    .orderBy(sql`SUM(${aiUsageLog.cost}) DESC`)
    .limit(10);

  return {
    totalPosts: totalPosts?.count ?? 0,
    postsByType: postsByType.map((p) => ({
      type: p.postType ?? "1:1",
      count: p.count,
    })),
    totalAiCost: Number.parseFloat(aiCostTotal?.totalCost ?? "0"),
    totalAiTokens: aiCostTotal?.totalTokens ?? 0,
    avgGenerationDuration: Math.round(aiCostTotal?.avgDuration ?? 0),
    totalAiRequests: aiCostTotal?.totalRequests ?? 0,
    backofficePostCount: backofficePostCount?.count ?? 0,
    topUsersByCost: costByUser.map((u) => ({
      userId: u.userId,
      email: u.email,
      totalCost: Number.parseFloat(u.totalCost ?? "0"),
      totalTokens: u.totalTokens,
      requestCount: u.requestCount,
    })),
  };
}

// ================================
// AdSet Edit Log Functions
// ================================

export type CreateAdSetEditLogData = {
  backofficeUserId: string;
  targetUserId: string;
  adsetId: string;
  accountId: string;
  campaignId?: string;
  adsetName?: string;
  previousDailyBudget?: string;
  newDailyBudget?: string;
  previousTargeting?: AdSetTargetingData;
  newTargeting?: AdSetTargetingData;
  note: string;
  appliedToMeta: boolean;
  errorMessage?: string;
};

export async function createAdSetEditLog(data: CreateAdSetEditLogData) {
  const [log] = await db
    .insert(adsetEditLog)
    .values({
      backofficeUserId: data.backofficeUserId,
      targetUserId: data.targetUserId,
      adsetId: data.adsetId,
      accountId: data.accountId,
      campaignId: data.campaignId,
      adsetName: data.adsetName,
      previousDailyBudget: data.previousDailyBudget,
      newDailyBudget: data.newDailyBudget,
      previousTargeting: data.previousTargeting,
      newTargeting: data.newTargeting,
      note: data.note,
      appliedToMeta: data.appliedToMeta,
      errorMessage: data.errorMessage,
    })
    .returning();

  return log;
}

export type AdSetEditLogWithAdmin = {
  id: string;
  backofficeUserId: string;
  backofficeUserEmail: string;
  targetUserId: string;
  adsetId: string;
  accountId: string;
  campaignId: string | null;
  adsetName: string | null;
  previousDailyBudget: string | null;
  newDailyBudget: string | null;
  previousTargeting: AdSetTargetingData | null;
  newTargeting: AdSetTargetingData | null;
  note: string;
  appliedToMeta: boolean;
  errorMessage: string | null;
  createdAt: Date;
};

export async function getAdSetEditLogs(
  adsetId: string
): Promise<AdSetEditLogWithAdmin[]> {
  const logs = await db
    .select({
      id: adsetEditLog.id,
      backofficeUserId: adsetEditLog.backofficeUserId,
      backofficeUserEmail: user.email,
      targetUserId: adsetEditLog.targetUserId,
      adsetId: adsetEditLog.adsetId,
      accountId: adsetEditLog.accountId,
      campaignId: adsetEditLog.campaignId,
      adsetName: adsetEditLog.adsetName,
      previousDailyBudget: adsetEditLog.previousDailyBudget,
      newDailyBudget: adsetEditLog.newDailyBudget,
      previousTargeting: adsetEditLog.previousTargeting,
      newTargeting: adsetEditLog.newTargeting,
      note: adsetEditLog.note,
      appliedToMeta: adsetEditLog.appliedToMeta,
      errorMessage: adsetEditLog.errorMessage,
      createdAt: adsetEditLog.createdAt,
    })
    .from(adsetEditLog)
    .innerJoin(user, eq(adsetEditLog.backofficeUserId, user.id))
    .where(eq(adsetEditLog.adsetId, adsetId))
    .orderBy(desc(adsetEditLog.createdAt));

  return logs;
}

