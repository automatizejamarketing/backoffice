import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db";
import {
  aiUsageLog,
  backofficeUser,
  businessManagedCampaignCache,
  businessOperatingRules,
  businessRuleChangeLog,
  company,
  metaBusinessAccount,
  post,
  subscription,
  user,
  userCompany,
  userMarketingConsultant,
  type BusinessOperatingRule,
  type Subscription,
} from "@/lib/db/schema";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import {
  DEFAULT_BUSINESS_OPERATING_RULES,
  evaluateBusinessHealth,
  getBusinessRuleChanges,
  type BusinessHealthEvaluation,
  type BusinessOperatingRules,
  type BusinessRuleChange,
} from "@/lib/business/business-health";
import { pickActiveSubscription } from "@/lib/subscriptions/derive";

export type BusinessOperatingRulesRecord = BusinessOperatingRules & {
  id: string;
  updatedByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BusinessRuleChangeLogItem = {
  id: string;
  adminEmail: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  createdAt: Date;
};

export type BusinessPortfolioItem = {
  userId: string;
  userEmail: string;
  userImageUrl: string | null;
  userPhone: string | null;
  credits: number;
  expirationDate: Date | null;
  companyName: string | null;
  onboardingCompleted: boolean;
  consultantId: string | null;
  consultantEmail: string | null;
  consultantName: string | null;
  subscriptionStatus: Subscription["status"] | null;
  subscriptionPlanType: Subscription["planType"] | null;
  subscriptionCurrentPeriodEnd: Date | null;
  subscriptionCancelAtPeriodEnd: boolean;
  metaAccountName: string | null;
  metaUpdatedAt: string | null;
  lastAiUsageAt: Date | null;
  lastPostAt: Date | null;
  postCount: number;
  hasActiveManagedCampaign: boolean;
  managedCampaignNames: string[];
  managedCampaignCheckedAt: Date | null;
  managedCampaignError: string | null;
  health: BusinessHealthEvaluation;
};

export type GetBusinessPortfolioParams = {
  consultantId?: string;
  userId?: string;
};

const DEFAULT_RULE_NAME = "default";

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rulesFromRow(row: BusinessOperatingRule): BusinessOperatingRulesRecord {
  return {
    id: row.id,
    renewalCriticalDays: row.renewalCriticalDays,
    renewalAttentionDays: row.renewalAttentionDays,
    trialCriticalDays: row.trialCriticalDays,
    trialAttentionDays: row.trialAttentionDays,
    inactivityAttentionDays: row.inactivityAttentionDays,
    lowCreditsThreshold: row.lowCreditsThreshold,
    managedCampaignNamePrefix: row.managedCampaignNamePrefix,
    activeManagedCampaignExcludesInactivity:
      row.activeManagedCampaignExcludesInactivity,
    updatedByEmail: row.updatedByEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function defaultRulesRecord(): BusinessOperatingRulesRecord {
  const now = new Date(0);
  return {
    id: "",
    ...DEFAULT_BUSINESS_OPERATING_RULES,
    updatedByEmail: null,
    createdAt: now,
    updatedAt: now,
  };
}

function validateRules(rules: BusinessOperatingRules) {
  const integerFields: Array<keyof Omit<
    BusinessOperatingRules,
    "managedCampaignNamePrefix" | "activeManagedCampaignExcludesInactivity"
  >> = [
    "renewalCriticalDays",
    "renewalAttentionDays",
    "trialCriticalDays",
    "trialAttentionDays",
    "inactivityAttentionDays",
    "lowCreditsThreshold",
  ];

  for (const field of integerFields) {
    const value = rules[field];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`invalid_${field}`);
    }
  }

  if (rules.inactivityAttentionDays < 1) {
    throw new Error("invalid_inactivityAttentionDays");
  }
  if (rules.renewalAttentionDays < rules.renewalCriticalDays) {
    throw new Error("invalid_renewal_window");
  }
  if (rules.trialAttentionDays < rules.trialCriticalDays) {
    throw new Error("invalid_trial_window");
  }
  if (!rules.managedCampaignNamePrefix.trim()) {
    throw new Error("invalid_managedCampaignNamePrefix");
  }
}

async function getRulesRow() {
  const [row] = await db
    .select()
    .from(businessOperatingRules)
    .where(eq(businessOperatingRules.name, DEFAULT_RULE_NAME))
    .limit(1);
  return row ?? null;
}

export async function getBusinessOperatingRules(): Promise<BusinessOperatingRulesRecord> {
  const row = await getRulesRow();
  return row ? rulesFromRow(row) : defaultRulesRecord();
}

export async function listBusinessRuleChangeLogs(
  limit = 50,
): Promise<BusinessRuleChangeLogItem[]> {
  return db
    .select({
      id: businessRuleChangeLog.id,
      adminEmail: businessRuleChangeLog.adminEmail,
      fieldName: businessRuleChangeLog.fieldName,
      oldValue: businessRuleChangeLog.oldValue,
      newValue: businessRuleChangeLog.newValue,
      createdAt: businessRuleChangeLog.createdAt,
    })
    .from(businessRuleChangeLog)
    .orderBy(desc(businessRuleChangeLog.createdAt))
    .limit(limit);
}

export async function updateBusinessOperatingRules(
  patch: Partial<BusinessOperatingRules>,
  adminEmail: string,
): Promise<{
  rules: BusinessOperatingRulesRecord;
  changes: BusinessRuleChange[];
}> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .insert(businessOperatingRules)
      .values({
        name: DEFAULT_RULE_NAME,
        ...DEFAULT_BUSINESS_OPERATING_RULES,
      })
      .onConflictDoNothing()
      .returning();

    const current =
      existing ??
      (
        await tx
          .select()
          .from(businessOperatingRules)
          .where(eq(businessOperatingRules.name, DEFAULT_RULE_NAME))
          .limit(1)
      )[0];

    if (!current) {
      throw new Error("business_rules_not_found");
    }

    const oldRules = rulesFromRow(current);
    const nextRules: BusinessOperatingRules = {
      renewalCriticalDays:
        patch.renewalCriticalDays ?? oldRules.renewalCriticalDays,
      renewalAttentionDays:
        patch.renewalAttentionDays ?? oldRules.renewalAttentionDays,
      trialCriticalDays: patch.trialCriticalDays ?? oldRules.trialCriticalDays,
      trialAttentionDays:
        patch.trialAttentionDays ?? oldRules.trialAttentionDays,
      inactivityAttentionDays:
        patch.inactivityAttentionDays ?? oldRules.inactivityAttentionDays,
      lowCreditsThreshold:
        patch.lowCreditsThreshold ?? oldRules.lowCreditsThreshold,
      managedCampaignNamePrefix:
        patch.managedCampaignNamePrefix?.trim() ??
        oldRules.managedCampaignNamePrefix,
      activeManagedCampaignExcludesInactivity:
        patch.activeManagedCampaignExcludesInactivity ??
        oldRules.activeManagedCampaignExcludesInactivity,
    };

    validateRules(nextRules);

    const changes = getBusinessRuleChanges(oldRules, nextRules);
    if (changes.length === 0) {
      return { rules: oldRules, changes };
    }

    const [updated] = await tx
      .update(businessOperatingRules)
      .set({
        renewalCriticalDays: nextRules.renewalCriticalDays,
        renewalAttentionDays: nextRules.renewalAttentionDays,
        trialCriticalDays: nextRules.trialCriticalDays,
        trialAttentionDays: nextRules.trialAttentionDays,
        inactivityAttentionDays: nextRules.inactivityAttentionDays,
        lowCreditsThreshold: nextRules.lowCreditsThreshold,
        managedCampaignNamePrefix: nextRules.managedCampaignNamePrefix,
        activeManagedCampaignExcludesInactivity:
          nextRules.activeManagedCampaignExcludesInactivity,
        updatedByEmail: adminEmail,
        updatedAt: new Date(),
      })
      .where(eq(businessOperatingRules.id, current.id))
      .returning();

    await tx.insert(businessRuleChangeLog).values(
      changes.map((change) => ({
        ruleId: current.id,
        adminEmail,
        fieldName: change.fieldName,
        oldValue: change.oldValue,
        newValue: change.newValue,
      })),
    );

    return { rules: rulesFromRow(updated), changes };
  });
}

export async function upsertManagedCampaignCache(data: {
  userId: string;
  adAccountId: string;
  adAccountName?: string | null;
  hasActiveManagedCampaign: boolean;
  managedCampaignNames: string[];
  errorMessage?: string | null;
}) {
  const now = new Date();
  const [row] = await db
    .insert(businessManagedCampaignCache)
    .values({
      userId: data.userId,
      adAccountId: data.adAccountId,
      adAccountName: data.adAccountName ?? null,
      checkedAt: now,
      hasActiveManagedCampaign: data.hasActiveManagedCampaign,
      managedCampaignNames: data.managedCampaignNames,
      errorMessage: data.errorMessage ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        businessManagedCampaignCache.userId,
        businessManagedCampaignCache.adAccountId,
      ],
      set: {
        adAccountName: data.adAccountName ?? null,
        checkedAt: now,
        hasActiveManagedCampaign: data.hasActiveManagedCampaign,
        managedCampaignNames: data.managedCampaignNames,
        errorMessage: data.errorMessage ?? null,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

function pickRenewalDate(item: {
  expirationDate: Date | null;
  activeSubscription: Pick<Subscription, "currentPeriodEnd"> | null;
}): Date | null {
  return item.activeSubscription?.currentPeriodEnd ?? item.expirationDate;
}

function compareBusinessItems(
  a: BusinessPortfolioItem,
  b: BusinessPortfolioItem,
) {
  const score = { critical: 0, attention: 1, healthy: 2 } as const;
  const statusDiff = score[a.health.status] - score[b.health.status];
  if (statusDiff !== 0) return statusDiff;

  const aRenewal = a.health.daysUntilRenewal ?? Number.POSITIVE_INFINITY;
  const bRenewal = b.health.daysUntilRenewal ?? Number.POSITIVE_INFINITY;
  if (aRenewal !== bRenewal) return aRenewal - bRenewal;

  const aInactive = a.health.daysSinceLastActivity ?? Number.POSITIVE_INFINITY;
  const bInactive = b.health.daysSinceLastActivity ?? Number.POSITIVE_INFINITY;
  if (aInactive !== bInactive) return bInactive - aInactive;

  return a.userEmail.localeCompare(b.userEmail);
}

export async function getBusinessPortfolio(
  actor: BackofficeActor,
  params: GetBusinessPortfolioParams = {},
): Promise<BusinessPortfolioItem[]> {
  const rules = await getBusinessOperatingRules();
  const conditions = [];

  if (params.userId) conditions.push(eq(user.id, params.userId));

  if (actor.role === "marketing_consultant") {
    conditions.push(eq(userMarketingConsultant.consultantId, actor.id));
  } else if (params.consultantId && params.consultantId !== "all") {
    if (params.consultantId === "unassigned") {
      conditions.push(isNull(userMarketingConsultant.consultantId));
    } else {
      conditions.push(eq(userMarketingConsultant.consultantId, params.consultantId));
    }
  }

  const baseRows = await db
    .select({
      userId: user.id,
      userEmail: user.email,
      userImageUrl: user.image_url,
      userPhone: user.phone,
      credits: user.credits,
      expirationDate: user.expirationDate,
      consultantId: backofficeUser.id,
      consultantEmail: backofficeUser.email,
      consultantName: backofficeUser.name,
    })
    .from(user)
    .leftJoin(
      userMarketingConsultant,
      eq(userMarketingConsultant.userId, user.id),
    )
    .leftJoin(
      backofficeUser,
      eq(userMarketingConsultant.consultantId, backofficeUser.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(user.email));

  const userIds = baseRows.map((row) => row.userId);
  if (userIds.length === 0) return [];

  const [
    companyRows,
    subRows,
    usageRows,
    postRows,
    metaRows,
    campaignRows,
  ] = await Promise.all([
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
      .select()
      .from(subscription)
      .where(inArray(subscription.userId, userIds)),
    db
      .select({
        userId: aiUsageLog.userId,
        lastAiUsageAt: sql<Date | string>`MAX(${aiUsageLog.createdAt})`,
      })
      .from(aiUsageLog)
      .where(
        and(
          inArray(aiUsageLog.userId, userIds),
          isNull(aiUsageLog.deletedAt),
        ),
      )
      .groupBy(aiUsageLog.userId),
    db
      .select({
        userId: post.userId,
        lastPostAt: sql<Date | string>`MAX(${post.createdAt})`,
        postCount: count(),
      })
      .from(post)
      .where(and(inArray(post.userId, userIds), isNull(post.deletedAt)))
      .groupBy(post.userId),
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
      .select()
      .from(businessManagedCampaignCache)
      .where(inArray(businessManagedCampaignCache.userId, userIds)),
  ]);

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
    if (list) list.push(row);
    else subsByUser.set(row.userId, [row]);
  }

  const usageByUser = new Map<string, Date | null>();
  for (const row of usageRows) {
    usageByUser.set(row.userId, asDate(row.lastAiUsageAt));
  }

  const postByUser = new Map<
    string,
    { lastPostAt: Date | null; postCount: number }
  >();
  for (const row of postRows) {
    postByUser.set(row.userId, {
      lastPostAt: asDate(row.lastPostAt),
      postCount: row.postCount,
    });
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

  const campaignByUser = new Map<
    string,
    {
      hasActiveManagedCampaign: boolean;
      managedCampaignNames: string[];
      managedCampaignCheckedAt: Date | null;
      managedCampaignError: string | null;
    }
  >();
  for (const row of campaignRows) {
    const current = campaignByUser.get(row.userId) ?? {
      hasActiveManagedCampaign: false,
      managedCampaignNames: [],
      managedCampaignCheckedAt: null,
      managedCampaignError: null,
    };
    current.hasActiveManagedCampaign =
      current.hasActiveManagedCampaign || row.hasActiveManagedCampaign;
    current.managedCampaignNames = Array.from(
      new Set([...current.managedCampaignNames, ...row.managedCampaignNames]),
    );
    if (
      !current.managedCampaignCheckedAt ||
      row.checkedAt > current.managedCampaignCheckedAt
    ) {
      current.managedCampaignCheckedAt = row.checkedAt;
    }
    current.managedCampaignError =
      current.managedCampaignError ?? row.errorMessage;
    campaignByUser.set(row.userId, current);
  }

  const items = baseRows.map((row): BusinessPortfolioItem => {
    const companyInfo = companyByUser.get(row.userId);
    const activeSubscription = pickActiveSubscription(
      subsByUser.get(row.userId) ?? [],
    );
    const postInfo = postByUser.get(row.userId);
    const metaInfo = metaByUser.get(row.userId);
    const campaignInfo = campaignByUser.get(row.userId);
    const expirationDate = asDate(row.expirationDate);
    const renewalDate = pickRenewalDate({
      expirationDate,
      activeSubscription,
    });

    const health = evaluateBusinessHealth({
      referenceDate: new Date(),
      rules,
      subscriptionStatus: activeSubscription?.status ?? null,
      renewalDate,
      credits: row.credits,
      onboardingCompleted: companyInfo?.onboardingCompleted ?? false,
      lastAiUsageAt: usageByUser.get(row.userId) ?? null,
      lastPostAt: postInfo?.lastPostAt ?? null,
      hasActiveManagedCampaign:
        campaignInfo?.hasActiveManagedCampaign ?? false,
    });

    return {
      userId: row.userId,
      userEmail: row.userEmail,
      userImageUrl: row.userImageUrl,
      userPhone: row.userPhone,
      credits: row.credits,
      expirationDate,
      companyName: companyInfo?.companyName ?? null,
      onboardingCompleted: companyInfo?.onboardingCompleted ?? false,
      consultantId: row.consultantId,
      consultantEmail: row.consultantEmail,
      consultantName: row.consultantName,
      subscriptionStatus: activeSubscription?.status ?? null,
      subscriptionPlanType: activeSubscription?.planType ?? null,
      subscriptionCurrentPeriodEnd:
        activeSubscription?.currentPeriodEnd ?? null,
      subscriptionCancelAtPeriodEnd:
        activeSubscription?.cancelAtPeriodEnd ?? false,
      metaAccountName: metaInfo?.metaAccountName ?? null,
      metaUpdatedAt: metaInfo?.metaUpdatedAt ?? null,
      lastAiUsageAt: usageByUser.get(row.userId) ?? null,
      lastPostAt: postInfo?.lastPostAt ?? null,
      postCount: postInfo?.postCount ?? 0,
      hasActiveManagedCampaign:
        campaignInfo?.hasActiveManagedCampaign ?? false,
      managedCampaignNames: campaignInfo?.managedCampaignNames ?? [],
      managedCampaignCheckedAt:
        campaignInfo?.managedCampaignCheckedAt ?? null,
      managedCampaignError: campaignInfo?.managedCampaignError ?? null,
      health,
    };
  });

  return items.sort(compareBusinessItems);
}

export async function getBusinessCustomerDetail(
  actor: BackofficeActor,
  userId: string,
): Promise<BusinessPortfolioItem | null> {
  const items = await getBusinessPortfolio(actor, { userId });
  return items[0] ?? null;
}
