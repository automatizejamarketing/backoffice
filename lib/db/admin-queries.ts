import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./index";
import {
  adsetEditLog,
  aiGeneratedText,
  aiUsageLog,
  backofficeUser,
  backofficeAuditLog,
  backofficeGeneratedPost,
  campaignEditLog,
  chat,
  company,
  generatedImage,
  generatedImageVersion,
  genericGeneratePost,
  metaBusinessAccount,
  payment,
  pendingPlanChange,
  post,
  referenceImage,
  subscription,
  subscriptionEvent,
  user,
  userCompany,
  userMarketingConsultant,
  type CampaignAdSetBudgetChangeData,
  type CampaignAdSetScheduleChangeData,
  type CampaignBudgetModeData,
  type AdSetTargetingData,
  type Payment,
  type PendingPlanChange,
  type Subscription,
  type SubscriptionEvent,
  type User,
} from "./schema";
import type { UsersFilterParams } from "@/lib/backoffice/users-filters";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";

export type ActiveSubscriptionSummary = Pick<
  Subscription,
  | "id"
  | "planType"
  | "status"
  | "currentPeriodEnd"
  | "cancelAtPeriodEnd"
  | "stripeSubscriptionId"
> | null;

export type UserWithUsage = User & {
  chatCount: number;
  postCount: number;
  totalCost: number;
  totalTokens: number;
  requestCount: number;
  companyName: string | null;
  onboardingCompleted: boolean;
  activeSubscription: ActiveSubscriptionSummary;
  hasMetaBusinessAccount: boolean;
  metaAccountName: string | null;
  metaUpdatedAt: string | null;
  assignedConsultantId: string | null;
  assignedConsultantEmail: string | null;
  assignedConsultantName: string | null;
};

export type GetAllUsersWithUsageParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  filters?: Partial<
    Pick<
      UsersFilterParams,
      "subscriptionStatus" | "planPeriod" | "metaStatus" | "consultantId"
    >
  >;
};

export type GetAllUsersWithUsageResult = {
  users: UserWithUsage[];
  total: number;
  page: number;
  pageSize: number;
};

export type UserHubProfile = Pick<
  User,
  "id" | "email" | "name" | "image_url" | "phone"
> & {
  companyName: string | null;
  onboardingCompleted: boolean;
};

// Minimum characters for the search filter to be applied. Shorter queries
// (typed while the user is still composing) are ignored so the listing isn't
// thrashed by partial keystrokes. Kept in sync with the toolbar UI.
const MIN_SEARCH_LENGTH = 3;

const activeSubscriptionStatusSql = sql`
  (
    SELECT s.status
    FROM subscriptions s
    WHERE s.user_id = ${user.id}
    ORDER BY
      CASE s.status
        WHEN 'active' THEN 1
        WHEN 'trialing' THEN 2
        WHEN 'past_due' THEN 3
        WHEN 'unpaid' THEN 4
        WHEN 'incomplete' THEN 5
        WHEN 'canceled' THEN 6
        WHEN 'incomplete_expired' THEN 7
        ELSE 99
      END,
      s.created_at DESC
    LIMIT 1
  )
`;

const activeSubscriptionPlanTypeSql = sql`
  (
    SELECT s.plan_type
    FROM subscriptions s
    WHERE s.user_id = ${user.id}
    ORDER BY
      CASE s.status
        WHEN 'active' THEN 1
        WHEN 'trialing' THEN 2
        WHEN 'past_due' THEN 3
        WHEN 'unpaid' THEN 4
        WHEN 'incomplete' THEN 5
        WHEN 'canceled' THEN 6
        WHEN 'incomplete_expired' THEN 7
        ELSE 99
      END,
      s.created_at DESC
    LIMIT 1
  )
`;

// Get a paginated list of users with their usage summary.
//
// Implementation note: this function used to issue 5 queries per user inside
// `Promise.all`, which saturated the connection pool and triggered Postgres
// statement timeouts. It now runs a fixed 6 queries per page regardless of
// total user count: 1 count + 1 page of users + 4 aggregates scoped to the
// page's userIds + 1 for subscriptions (still picked in memory via
// `pickActiveSubscription` so the priority logic stays in one place).
export async function getAllUsersWithUsage(
  params: GetAllUsersWithUsageParams = {},
): Promise<GetAllUsersWithUsageResult> {
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const pageSize = Math.max(1, Math.trunc(params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const trimmedSearch = params.search?.trim() ?? "";
  const conditions = [];

  if (trimmedSearch.length >= MIN_SEARCH_LENGTH) {
    conditions.push(
      or(
        ilike(user.email, `%${trimmedSearch}%`),
        ilike(user.name, `%${trimmedSearch}%`),
      ),
    );
  }

  if (
    params.filters?.subscriptionStatus &&
    params.filters.subscriptionStatus !== "all"
  ) {
    conditions.push(
      sql`${activeSubscriptionStatusSql} = ${params.filters.subscriptionStatus}`,
    );
  }

  if (params.filters?.planPeriod && params.filters.planPeriod !== "all") {
    conditions.push(
      sql`${activeSubscriptionPlanTypeSql} LIKE ${`${params.filters.planPeriod}_%`}`,
    );
  }

  if (params.filters?.metaStatus === "connected") {
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM meta_business_accounts mba
      WHERE mba.user_id = ${user.id}
        AND mba.deleted_at IS NULL
    )`);
  }

  if (params.filters?.metaStatus === "disconnected") {
    conditions.push(sql`NOT EXISTS (
      SELECT 1
      FROM meta_business_accounts mba
      WHERE mba.user_id = ${user.id}
        AND mba.deleted_at IS NULL
    )`);
  }

  if (params.filters?.consultantId && params.filters.consultantId !== "all") {
    if (params.filters.consultantId === "unassigned") {
      conditions.push(sql`NOT EXISTS (
        SELECT 1
        FROM user_marketing_consultants umc
        WHERE umc.user_id = ${user.id}
      )`);
    } else {
      conditions.push(sql`EXISTS (
        SELECT 1
        FROM user_marketing_consultants umc
        WHERE umc.user_id = ${user.id}
          AND umc.consultant_id = ${params.filters.consultantId}
      )`);
    }
  }

  const whereFilter = conditions.length > 0 ? and(...conditions) : undefined;

  const [usersPage, [totalRow]] = await Promise.all([
    db
      .select()
      .from(user)
      .where(whereFilter)
      .orderBy(desc(user.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: count() }).from(user).where(whereFilter),
  ]);

  const total = totalRow?.count ?? 0;
  const userIds = usersPage.map((u) => u.id);

  if (userIds.length === 0) {
    return { users: [], total, page, pageSize };
  }

  const [
    chatCounts,
    postCounts,
    usageRows,
    companyRows,
    subRows,
    metaRows,
    consultantRows,
  ] = await Promise.all([
    db
      .select({
        userId: chat.userId,
        count: count(),
      })
      .from(chat)
      .where(inArray(chat.userId, userIds))
      .groupBy(chat.userId),
    db
      .select({
        userId: post.userId,
        count: count(),
      })
      .from(post)
      .where(inArray(post.userId, userIds))
      .groupBy(post.userId),
    db
      .select({
        userId: aiUsageLog.userId,
        totalCost: sql<string>`COALESCE(SUM(${aiUsageLog.cost}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`,
        requestCount: count(),
      })
      .from(aiUsageLog)
      .where(inArray(aiUsageLog.userId, userIds))
      .groupBy(aiUsageLog.userId),
    db
      .select({
        userId: userCompany.userId,
        companyName: company.name,
        onboardingCompleted: company.onboardingCompleted,
      })
      .from(userCompany)
      .leftJoin(company, eq(userCompany.companyId, company.id))
      .where(inArray(userCompany.userId, userIds)),
    db
      .select({
        userId: subscription.userId,
        id: subscription.id,
        planType: subscription.planType,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        createdAt: subscription.createdAt,
      })
      .from(subscription)
      .where(inArray(subscription.userId, userIds)),
    db
      .select({
        userId: metaBusinessAccount.userId,
        metaAccountName: sql<
          string | null
        >`(array_agg(${metaBusinessAccount.name} ORDER BY ${metaBusinessAccount.updatedAt} DESC))[1]`,
        metaUpdatedAt: sql<
          Date | string
        >`MAX(${metaBusinessAccount.updatedAt})`,
      })
      .from(metaBusinessAccount)
      .where(
        and(
          inArray(metaBusinessAccount.userId, userIds),
          isNull(metaBusinessAccount.deletedAt),
        ),
      )
      .groupBy(metaBusinessAccount.userId),
    db
      .select({
        userId: userMarketingConsultant.userId,
        consultantId: backofficeUser.id,
        consultantEmail: backofficeUser.email,
        consultantName: backofficeUser.name,
      })
      .from(userMarketingConsultant)
      .innerJoin(
        backofficeUser,
        eq(userMarketingConsultant.consultantId, backofficeUser.id),
      )
      .where(inArray(userMarketingConsultant.userId, userIds)),
  ]);

  const chatCountByUser = new Map<string, number>();
  for (const row of chatCounts) {
    chatCountByUser.set(row.userId, row.count);
  }

  const postCountByUser = new Map<string, number>();
  for (const row of postCounts) {
    postCountByUser.set(row.userId, row.count);
  }

  const usageByUser = new Map<
    string,
    { totalCost: string; totalTokens: number; requestCount: number }
  >();
  for (const row of usageRows) {
    usageByUser.set(row.userId, {
      totalCost: row.totalCost,
      totalTokens: row.totalTokens,
      requestCount: row.requestCount,
    });
  }

  // Preserves the legacy `LIMIT 1` semantics: keep the first company row seen
  // per user and ignore subsequent rows when a user belongs to multiple.
  const companyByUser = new Map<
    string,
    { companyName: string | null; onboardingCompleted: boolean }
  >();
  for (const row of companyRows) {
    if (companyByUser.has(row.userId)) continue;
    companyByUser.set(row.userId, {
      companyName: row.companyName ?? null,
      onboardingCompleted: row.onboardingCompleted ?? false,
    });
  }

  type SubRow = (typeof subRows)[number];
  const subsByUser = new Map<string, SubRow[]>();
  for (const row of subRows) {
    const list = subsByUser.get(row.userId);
    if (list) {
      list.push(row);
    } else {
      subsByUser.set(row.userId, [row]);
    }
  }

  const metaByUser = new Map<
    string,
    { metaAccountName: string | null; metaUpdatedAt: string | null }
  >();
  for (const row of metaRows) {
    metaByUser.set(row.userId, {
      metaAccountName: row.metaAccountName,
      metaUpdatedAt:
        row.metaUpdatedAt instanceof Date
          ? row.metaUpdatedAt.toISOString()
          : row.metaUpdatedAt
            ? String(row.metaUpdatedAt)
            : null,
    });
  }

  const consultantByUser = new Map<
    string,
    { id: string; email: string; name: string | null }
  >();
  for (const row of consultantRows) {
    consultantByUser.set(row.userId, {
      id: row.consultantId,
      email: row.consultantEmail,
      name: row.consultantName,
    });
  }

  const users: UserWithUsage[] = usersPage.map((u) => {
    const usage = usageByUser.get(u.id);
    const companyInfo = companyByUser.get(u.id);
    const userSubs = subsByUser.get(u.id) ?? [];
    const activeSub = pickActiveSubscription(userSubs);
    const metaInfo = metaByUser.get(u.id);
    const consultant = consultantByUser.get(u.id);
    const activeSubscription: ActiveSubscriptionSummary = activeSub
      ? {
          id: activeSub.id,
          planType: activeSub.planType,
          status: activeSub.status,
          currentPeriodEnd: activeSub.currentPeriodEnd,
          cancelAtPeriodEnd: activeSub.cancelAtPeriodEnd,
          stripeSubscriptionId: activeSub.stripeSubscriptionId,
        }
      : null;

    return {
      ...u,
      chatCount: chatCountByUser.get(u.id) ?? 0,
      postCount: postCountByUser.get(u.id) ?? 0,
      totalCost: Number.parseFloat(usage?.totalCost ?? "0"),
      totalTokens: usage?.totalTokens ?? 0,
      requestCount: usage?.requestCount ?? 0,
      companyName: companyInfo?.companyName ?? null,
      onboardingCompleted: companyInfo?.onboardingCompleted ?? false,
      activeSubscription,
      hasMetaBusinessAccount: Boolean(metaInfo),
      metaAccountName: metaInfo?.metaAccountName ?? null,
      metaUpdatedAt: metaInfo?.metaUpdatedAt ?? null,
      assignedConsultantId: consultant?.id ?? null,
      assignedConsultantEmail: consultant?.email ?? null,
      assignedConsultantName: consultant?.name ?? null,
    };
  });

  return { users, total, page, pageSize };
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

  // Pick active-ish subscription (active > trialing > past_due > ...)
  const subRows = await db
    .select()
    .from(subscription)
    .where(eq(subscription.userId, userId));
  const activeSubscription: Subscription | null =
    pickActiveSubscription(subRows);

  // Most recent pending plan change for this user (if any)
  let activePendingPlanChange: PendingPlanChange | null = null;
  if (activeSubscription) {
    const [pp] = await db
      .select()
      .from(pendingPlanChange)
      .where(
        and(
          eq(pendingPlanChange.userId, userId),
          eq(pendingPlanChange.status, "pending"),
        ),
      )
      .orderBy(desc(pendingPlanChange.createdAt))
      .limit(1);
    activePendingPlanChange = pp ?? null;
  }

  // Calculate totals
  const totalCost = recentUsage.reduce(
    (sum, log) => sum + Number.parseFloat(log.cost),
    0,
  );
  const totalTokens = recentUsage.reduce(
    (sum, log) => sum + log.totalTokens,
    0,
  );

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
    activeSubscription,
    activePendingPlanChange,
  };
}

export async function getUserHubProfile(
  userId: string,
): Promise<UserHubProfile | null> {
  const [foundUser] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      image_url: user.image_url,
      phone: user.phone,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!foundUser) return null;

  const [companyInfo] = await db
    .select({
      companyName: company.name,
      onboardingCompleted: company.onboardingCompleted,
    })
    .from(userCompany)
    .leftJoin(company, eq(userCompany.companyId, company.id))
    .where(eq(userCompany.userId, userId))
    .limit(1);

  return {
    ...foundUser,
    companyName: companyInfo?.companyName ?? null,
    onboardingCompleted: companyInfo?.onboardingCompleted ?? false,
  };
}

export interface UserSubscriptionDetails {
  user: User;
  activeSubscription: Subscription | null;
  pendingPlanChange: PendingPlanChange | null;
  subscriptionHistory: Subscription[];
  payments: Payment[];
  events: SubscriptionEvent[];
}

/**
 * Loads everything needed to render the admin subscription detail page for a
 * user: full user row, the most relevant subscription (active > trialing >
 * past_due > ...), the latest pending plan change, the full subscription
 * history, and the most recent 50 payments and events.
 */
export async function getUserSubscriptionDetails(
  userId: string,
): Promise<UserSubscriptionDetails | null> {
  const [foundUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!foundUser) return null;

  const [subscriptions, payments, events, pendingChanges] = await Promise.all([
    db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .orderBy(desc(subscription.createdAt)),
    db
      .select()
      .from(payment)
      .where(eq(payment.userId, userId))
      .orderBy(desc(payment.createdAt))
      .limit(50),
    db
      .select()
      .from(subscriptionEvent)
      .where(eq(subscriptionEvent.userId, userId))
      .orderBy(desc(subscriptionEvent.createdAt))
      .limit(50),
    db
      .select()
      .from(pendingPlanChange)
      .where(
        and(
          eq(pendingPlanChange.userId, userId),
          eq(pendingPlanChange.status, "pending"),
        ),
      )
      .orderBy(desc(pendingPlanChange.createdAt))
      .limit(1),
  ]);

  return {
    user: foundUser,
    activeSubscription: pickActiveSubscription(subscriptions),
    pendingPlanChange: pendingChanges[0] ?? null,
    subscriptionHistory: subscriptions,
    payments,
    events,
  };
}

function getPostgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  const seen = new Set<object>();
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current !== "object" || current === null) break;
    if (seen.has(current)) break;
    seen.add(current);
    if (
      "code" in current &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    if ("cause" in current) {
      current = (current as { cause: unknown }).cause;
      continue;
    }
    break;
  }
  return undefined;
}

export async function getUserAuditLogs(userId: string, limit = 50) {
  try {
    return await db
      .select()
      .from(backofficeAuditLog)
      .where(eq(backofficeAuditLog.targetUserId, userId))
      .orderBy(desc(backofficeAuditLog.createdAt))
      .limit(limit);
  } catch (error) {
    if (getPostgresErrorCode(error) === "42P01") {
      console.warn(
        "[getUserAuditLogs] Table backoffice_audit_logs is missing. Apply migrations: npm run db:push (or run lib/db/migrations/0001_backoffice_audit_logs.sql).",
      );
      return [];
    }
    throw error;
  }
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

// Get user's Meta Business Account (most recently updated, non-deleted)
export async function getUserMetaBusinessAccount(userId: string) {
  const [account] = await db
    .select()
    .from(metaBusinessAccount)
    .where(
      and(
        eq(metaBusinessAccount.userId, userId),
        isNull(metaBusinessAccount.deletedAt),
      ),
    )
    .orderBy(desc(metaBusinessAccount.updatedAt))
    .limit(1);
  return account ?? null;
}

// ================================
// Users with a connected Meta Business Account (Marketing)
// ================================

export type UserWithMetaBusinessAccount = {
  id: string;
  email: string;
  image_url: string | null;
  metaAccountName: string | null;
  metaUpdatedAt: string;
};

export type GetUsersWithMetaBusinessAccountResult = {
  users: UserWithMetaBusinessAccount[];
  total: number;
  page: number;
  limit: number;
};

// Returns one row per user that has at least one non-deleted meta_business_accounts
// row. When a user has multiple connected accounts, the most-recently-updated one is
// shown (matching getUserMetaBusinessAccount's semantics).
export async function getUsersWithMetaBusinessAccount(options?: {
  email?: string;
  page?: number;
  limit?: number;
  userIds?: string[];
}): Promise<GetUsersWithMetaBusinessAccountResult> {
  const page = Math.max(1, Math.trunc(options?.page ?? 1));
  const limit = Math.max(1, Math.trunc(options?.limit ?? 20));
  const offset = (page - 1) * limit;

  if (options?.userIds && options.userIds.length === 0) {
    return { users: [], total: 0, page, limit };
  }

  const conditions = [isNull(metaBusinessAccount.deletedAt)];
  if (options?.email) {
    conditions.push(ilike(user.email, `%${options.email}%`));
  }
  if (options?.userIds) {
    conditions.push(inArray(user.id, options.userIds));
  }

  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      image_url: user.image_url,
      metaAccountName: sql<
        string | null
      >`(array_agg(${metaBusinessAccount.name} ORDER BY ${metaBusinessAccount.updatedAt} DESC))[1]`,
      metaUpdatedAt: sql<Date | string>`MAX(${metaBusinessAccount.updatedAt})`,
    })
    .from(user)
    .innerJoin(metaBusinessAccount, eq(metaBusinessAccount.userId, user.id))
    .where(and(...conditions))
    .groupBy(user.id, user.email, user.image_url)
    .orderBy(desc(sql`MAX(${metaBusinessAccount.updatedAt})`))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${user.id})` })
    .from(user)
    .innerJoin(metaBusinessAccount, eq(metaBusinessAccount.userId, user.id))
    .where(and(...conditions));

  return {
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      image_url: row.image_url,
      metaAccountName: row.metaAccountName,
      metaUpdatedAt:
        row.metaUpdatedAt instanceof Date
          ? row.metaUpdatedAt.toISOString()
          : String(row.metaUpdatedAt),
    })),
    total: Number(totalResult?.count ?? 0),
    page,
    limit,
  };
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
    }),
  );

  return {
    users: usersWithCompany,
    total: totalResult?.count ?? 0,
    page,
    limit,
  };
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
  if (options?.userId)
    conditions.push(eq(generatedImage.userId, options.userId));
  if (options?.status)
    conditions.push(eq(generatedImage.status, options.status));
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
    .innerJoin(
      generatedImage,
      eq(generatedImageVersion.generatedImageId, generatedImage.id),
    )
    .innerJoin(user, eq(generatedImage.userId, user.id))
    .where(and(...conditions))
    .orderBy(desc(generatedImage.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalResult] = await db
    .select({ count: count() })
    .from(generatedImageVersion)
    .innerJoin(
      generatedImage,
      eq(generatedImageVersion.generatedImageId, generatedImage.id),
    )
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
    .innerJoin(
      generatedImage,
      eq(generatedImageVersion.generatedImageId, generatedImage.id),
    )
    .where(
      and(
        inArray(generatedImageVersion.sourceAiGeneratedImageId, rootIds),
        isNull(generatedImage.deletedAt),
      ),
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
    .leftJoin(
      aiGeneratedText,
      eq(genericGeneratePost.captionTextId, aiGeneratedText.id),
    )
    .where(
      and(
        inArray(genericGeneratePost.postImageId, rootIds),
        isNull(genericGeneratePost.deletedAt),
      ),
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
  imageId: string,
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
    .innerJoin(
      generatedImage,
      eq(generatedImageVersion.generatedImageId, generatedImage.id),
    )
    .where(
      and(
        eq(generatedImageVersion.sourceAiGeneratedImageId, imageId),
        isNull(generatedImage.deletedAt),
      ),
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
      ),
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

  const posts = await db
    .select({
      id: backofficeGeneratedPost.id,
      backofficeUserId: backofficeGeneratedPost.backofficeUserId,
      backofficeUserEmail: sql<string>`(SELECT email FROM users WHERE id = ${backofficeGeneratedPost.backofficeUserId})`,
      targetUserId: backofficeGeneratedPost.targetUserId,
      targetUserEmail: sql<string>`(SELECT email FROM users WHERE id = ${backofficeGeneratedPost.targetUserId})`,
      sourceUserGeneratedImageId:
        backofficeGeneratedPost.sourceUserGeneratedImageId,
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
      eq(backofficeGeneratedPost.generatedImageId, generatedImage.id),
    )
    .leftJoin(
      aiGeneratedText,
      eq(backofficeGeneratedPost.captionTextId, aiGeneratedText.id),
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
  }>,
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
    .innerJoin(
      generatedImage,
      eq(generatedImageVersion.generatedImageId, generatedImage.id),
    )
    .where(imgConditions);

  const postsByType = await db
    .select({
      postType: generatedImage.aspectRatio,
      count: count(),
    })
    .from(generatedImageVersion)
    .innerJoin(
      generatedImage,
      eq(generatedImageVersion.generatedImageId, generatedImage.id),
    )
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
  backofficeUserEmail: string;
  targetUserId: string;
  adsetId: string;
  accountId: string;
  campaignId?: string;
  adsetName?: string;
  previousDailyBudget?: string;
  newDailyBudget?: string;
  previousLifetimeBudget?: string;
  newLifetimeBudget?: string;
  previousStartTime?: string;
  newStartTime?: string;
  previousEndTime?: string;
  newEndTime?: string;
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
      backofficeUserEmail: data.backofficeUserEmail,
      targetUserId: data.targetUserId,
      adsetId: data.adsetId,
      accountId: data.accountId,
      campaignId: data.campaignId,
      adsetName: data.adsetName,
      previousDailyBudget: data.previousDailyBudget,
      newDailyBudget: data.newDailyBudget,
      previousLifetimeBudget: data.previousLifetimeBudget,
      newLifetimeBudget: data.newLifetimeBudget,
      previousStartTime: data.previousStartTime,
      newStartTime: data.newStartTime,
      previousEndTime: data.previousEndTime,
      newEndTime: data.newEndTime,
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
  backofficeUserEmail: string;
  targetUserId: string;
  adsetId: string;
  accountId: string;
  campaignId: string | null;
  adsetName: string | null;
  previousDailyBudget: string | null;
  newDailyBudget: string | null;
  previousLifetimeBudget: string | null;
  newLifetimeBudget: string | null;
  previousStartTime: string | null;
  newStartTime: string | null;
  previousEndTime: string | null;
  newEndTime: string | null;
  previousTargeting: AdSetTargetingData | null;
  newTargeting: AdSetTargetingData | null;
  note: string;
  appliedToMeta: boolean;
  errorMessage: string | null;
  createdAt: Date;
};

export async function getAdSetEditLogs(
  adsetId: string,
  targetUserId?: string,
): Promise<AdSetEditLogWithAdmin[]> {
  const logs = await db
    .select({
      id: adsetEditLog.id,
      backofficeUserEmail: adsetEditLog.backofficeUserEmail,
      targetUserId: adsetEditLog.targetUserId,
      adsetId: adsetEditLog.adsetId,
      accountId: adsetEditLog.accountId,
      campaignId: adsetEditLog.campaignId,
      adsetName: adsetEditLog.adsetName,
      previousDailyBudget: adsetEditLog.previousDailyBudget,
      newDailyBudget: adsetEditLog.newDailyBudget,
      previousLifetimeBudget: adsetEditLog.previousLifetimeBudget,
      newLifetimeBudget: adsetEditLog.newLifetimeBudget,
      previousStartTime: adsetEditLog.previousStartTime,
      newStartTime: adsetEditLog.newStartTime,
      previousEndTime: adsetEditLog.previousEndTime,
      newEndTime: adsetEditLog.newEndTime,
      previousTargeting: adsetEditLog.previousTargeting,
      newTargeting: adsetEditLog.newTargeting,
      note: adsetEditLog.note,
      appliedToMeta: adsetEditLog.appliedToMeta,
      errorMessage: adsetEditLog.errorMessage,
      createdAt: adsetEditLog.createdAt,
    })
    .from(adsetEditLog)
    .where(
      targetUserId
        ? and(
            eq(adsetEditLog.adsetId, adsetId),
            eq(adsetEditLog.targetUserId, targetUserId),
          )
        : eq(adsetEditLog.adsetId, adsetId),
    )
    .orderBy(desc(adsetEditLog.createdAt));

  return logs;
}

// ================================
// Campaign Edit Log Functions
// ================================

export type CreateCampaignEditLogData = {
  backofficeUserEmail: string;
  targetUserId: string;
  campaignId: string;
  accountId: string;
  campaignName?: string;
  previousBudgetMode: CampaignBudgetModeData;
  newBudgetMode: CampaignBudgetModeData;
  previousDailyBudget?: string | null;
  newDailyBudget?: string;
  previousLifetimeBudget?: string | null;
  newLifetimeBudget?: string;
  adsetBudgetChanges?: CampaignAdSetBudgetChangeData[];
  adsetScheduleChanges?: CampaignAdSetScheduleChangeData[];
  note: string;
  appliedToMeta: boolean;
  errorMessage?: string;
};

export async function createCampaignEditLog(data: CreateCampaignEditLogData) {
  const [log] = await db
    .insert(campaignEditLog)
    .values({
      backofficeUserEmail: data.backofficeUserEmail,
      targetUserId: data.targetUserId,
      campaignId: data.campaignId,
      accountId: data.accountId,
      campaignName: data.campaignName,
      previousBudgetMode: data.previousBudgetMode,
      newBudgetMode: data.newBudgetMode,
      previousDailyBudget: data.previousDailyBudget,
      newDailyBudget: data.newDailyBudget,
      previousLifetimeBudget: data.previousLifetimeBudget,
      newLifetimeBudget: data.newLifetimeBudget,
      adsetBudgetChanges: data.adsetBudgetChanges,
      adsetScheduleChanges: data.adsetScheduleChanges,
      note: data.note,
      appliedToMeta: data.appliedToMeta,
      errorMessage: data.errorMessage,
    })
    .returning();

  return log;
}
