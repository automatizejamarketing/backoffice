import { count, desc, eq, gte, ilike, sql, sum } from "drizzle-orm";
import { db } from "./index";
import {
  aiUsageLog,
  chat,
  company,
  metaBusinessAccount,
  post,
  user,
  userCompany,
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

  // Get usage breakdown by action
  const usageByAction = await db
    .select({
      action: aiUsageLog.action,
      totalCost: sql<string>`SUM(${aiUsageLog.cost})`,
      totalTokens: sql<number>`SUM(${aiUsageLog.totalTokens})`,
      requestCount: count(),
    })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.userId, userId))
    .groupBy(aiUsageLog.action);

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

