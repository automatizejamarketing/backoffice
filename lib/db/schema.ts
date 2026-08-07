import { sql, type InferSelectModel } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AppUsage } from "../usage";
import type { Layer, PostStatus } from "../types";
import type { BackofficeRole } from "@/lib/auth/rbac-core";

export const user = pgTable("users", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  password: text("password"),
  authProvider: varchar("auth_provider", { length: 20 })
    .notNull()
    .default("google"),
  emailVerified: timestamp("email_verified"),
  image_url: text("image_url"),
  locale: varchar("locale", { length: 10 }),
  // Brazilian phone in digits-only canonical form (10 or 11 chars, no country
  // code prefix — all users are BR). Optional. Collected on credentials sign-up.
  phone: varchar("phone", { length: 16 }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  expirationDate: timestamp("expiration_date"),
  credits: integer("credits").notNull().default(0),
  referredByAffiliateId: uuid("referred_by_affiliate_id"),
  referredByTrackableLinkId: uuid("referred_by_trackable_link_id"),
  onboardingCardDismissedAt: timestamp("onboarding_card_dismissed_at"),
  onboardingWelcomeSeenAt: timestamp("onboarding_welcome_seen_at"),
  onboardingProfileBannerDismissedAt: timestamp(
    "onboarding_profile_banner_dismissed_at",
  ),
  // Signup timestamp. Nullable: rows created before this column existed stay
  // NULL (their real signup date is unknown); new signups get now() via the DB
  // default. Added for the trackable-link "users per link" view.
  createdAt: timestamp("created_at").defaultNow(),
});

export type User = InferSelectModel<typeof user>;

export type WhatsappTemplateDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "deleted";

export const whatsappTemplateDelivery = pgTable(
  "whatsapp_template_deliveries",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    source: varchar("source", { length: 64 }).notNull(),
    sourceDeliveryId: varchar("source_delivery_id", { length: 255 }).notNull(),
    templateName: varchar("template_name", { length: 255 }).notNull(),
    languageCode: varchar("language_code", { length: 16 })
      .notNull()
      .default("pt_BR"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    currentStatus: varchar("current_status", { length: 32 })
      .$type<WhatsappTemplateDeliveryStatus>()
      .notNull()
      .default("queued"),
    currentStatusAt: timestamp("current_status_at"),
    acceptedAt: timestamp("accepted_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    failedAt: timestamp("failed_at"),
    deletedAt: timestamp("deleted_at"),
    failureCode: varchar("failure_code", { length: 64 }),
    failureDetail: text("failure_detail"),
    historicalStatusUntracked: boolean("historical_status_untracked")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sourceUnique: unique("whatsapp_template_deliveries_source_unique").on(
      table.source,
      table.sourceDeliveryId,
    ),
    providerMessageUnique: unique(
      "whatsapp_template_deliveries_provider_message_unique",
    ).on(table.providerMessageId),
    userCreatedIdx: index("whatsapp_template_deliveries_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    templateCreatedIdx: index(
      "whatsapp_template_deliveries_template_created_idx",
    ).on(table.templateName, table.createdAt),
    statusCreatedIdx: index(
      "whatsapp_template_deliveries_status_created_idx",
    ).on(table.currentStatus, table.createdAt),
    providerMessageIdx: index(
      "whatsapp_template_deliveries_provider_message_idx",
    ).on(table.providerMessageId),
  }),
);

export const whatsappTemplateStatusEvent = pgTable(
  "whatsapp_template_status_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    deliveryId: uuid("delivery_id").references(
      () => whatsappTemplateDelivery.id,
      { onDelete: "cascade" },
    ),
    eventKey: varchar("event_key", { length: 512 }).notNull(),
    providerMessageId: varchar("provider_message_id", {
      length: 255,
    }).notNull(),
    providerStatus: varchar("provider_status", { length: 32 })
      .$type<Exclude<WhatsappTemplateDeliveryStatus, "queued">>()
      .notNull(),
    providerStatusAt: timestamp("provider_status_at").notNull(),
    failureCode: varchar("failure_code", { length: 64 }),
    failureDetail: text("failure_detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventKeyUnique: unique(
      "whatsapp_template_status_events_event_key_unique",
    ).on(table.eventKey),
    providerStatusIdx: index(
      "whatsapp_template_status_events_provider_status_idx",
    ).on(table.providerMessageId, table.providerStatusAt),
  }),
);

export type WhatsappTemplateDelivery = InferSelectModel<
  typeof whatsappTemplateDelivery
>;
export type WhatsappTemplateStatusEvent = InferSelectModel<
  typeof whatsappTemplateStatusEvent
>;

export const backofficeUser = pgTable("backoffice_users", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  role: varchar("role", {
    enum: ["admin", "dev", "marketing_consultant", "finance_viewer"],
  })
    .$type<BackofficeRole>()
    .notNull()
    .default("marketing_consultant"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BackofficeUser = InferSelectModel<typeof backofficeUser>;

export const userMarketingConsultant = pgTable(
  "user_marketing_consultants",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    consultantId: uuid("consultant_id")
      .notNull()
      .references(() => backofficeUser.id),
    assignedByEmail: varchar("assigned_by_email", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId] }),
    consultantIdx: index("user_marketing_consultants_consultant_id_idx").on(
      table.consultantId,
    ),
  }),
);

export type UserMarketingConsultant = InferSelectModel<
  typeof userMarketingConsultant
>;

export const backofficeMagicLink = pgTable(
  "backoffice_magic_links",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    email: varchar("email", { length: 100 }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: unique("backoffice_magic_links_token_hash_unique").on(
      table.tokenHash,
    ),
    emailIdx: index("backoffice_magic_links_email_idx").on(table.email),
  }),
);

export type BackofficeMagicLink = InferSelectModel<typeof backofficeMagicLink>;

export const blobUpload = pgTable("blob_uploads", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  blobUrl: text("blob_url").notNull(),
  pathname: text("pathname"),
  filename: text("filename"),
  contentType: text("content_type"),
  source: varchar("source", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type BlobUpload = InferSelectModel<typeof blobUpload>;

export const masterclassCourse = pgTable("masterclass_courses", {
  id: text("id").primaryKey().notNull(),
  title: text("title").notNull(),
  description: text("description"),
  slug: text("slug").notNull().unique(),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type MasterclassCourse = InferSelectModel<typeof masterclassCourse>;

export const masterclassLesson = pgTable(
  "masterclass_lessons",
  {
    id: text("id").primaryKey().notNull(),
    courseId: text("course_id")
      .notNull()
      .references(() => masterclassCourse.id),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    videoProvider: varchar("video_provider", { length: 20 })
      .notNull()
      .default("youtube"),
    videoAssetId: text("video_asset_id").notNull(),
    position: integer("position").notNull(),
    supportMaterialTitle: text("support_material_title"),
    supportMaterialUrl: text("support_material_url"),
    published: boolean("published").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    coursePositionIdx: index("masterclass_lessons_course_id_position_idx").on(
      table.courseId,
      table.position,
    ),
    uniqueCoursePosition: unique(
      "masterclass_lessons_course_position_unique",
    ).on(table.courseId, table.position),
    uniqueCourseSlug: unique("masterclass_lessons_course_slug_unique").on(
      table.courseId,
      table.slug,
    ),
  }),
);

export type MasterclassLesson = InferSelectModel<typeof masterclassLesson>;

// =============================================
// Digital Products
// =============================================

export const PRODUCT_OWNER_VALUES = ["automatize", "expert"] as const;
export type ProductOwnerType = (typeof PRODUCT_OWNER_VALUES)[number];

export const PRODUCT_STATUS_VALUES = ["draft", "published", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUS_VALUES)[number];

export const PRODUCT_VISIBILITY_VALUES = ["public", "unlisted"] as const;
export type ProductVisibility = (typeof PRODUCT_VISIBILITY_VALUES)[number];

export const PRODUCT_PLAN_TIER_VALUES = ["starter", "pro", "premium"] as const;
export type ProductPlanTier = (typeof PRODUCT_PLAN_TIER_VALUES)[number];

export const PRODUCT_CONTENT_TYPE_VALUES = [
  "video",
  "pdf",
  "file",
  "external_link",
] as const;
export type ProductContentType = (typeof PRODUCT_CONTENT_TYPE_VALUES)[number];

export const expertProfile = pgTable(
  "expert_profiles",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    profileImageUrl: text("profile_image_url"),
    phone: varchar("phone", { length: 20 }),
    pixKey: varchar("pix_key", { length: 255 }).notNull(),
    status: varchar("status", { enum: ["active", "inactive"] })
      .$type<"active" | "inactive">()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userUnique: unique("expert_profiles_user_id_unique").on(table.userId),
    statusIdx: index("expert_profiles_status_idx").on(table.status),
  }),
);

export type ExpertProfile = InferSelectModel<typeof expertProfile>;

export const productFinancialSetting = pgTable(
  "product_financial_settings",
  {
    id: varchar("id", { length: 32 }).primaryKey().notNull().default("default"),
    platformFeeBasisPoints: integer("platform_fee_basis_points")
      .notNull()
      .default(500),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    platformFeeCheck: check(
      "product_financial_settings_platform_fee_range",
      sql`${table.platformFeeBasisPoints} >= 0 AND ${table.platformFeeBasisPoints} <= 10000`,
    ),
  }),
);

export type ProductFinancialSetting = InferSelectModel<
  typeof productFinancialSetting
>;

export const product = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    ownerType: varchar("owner_type", { enum: [...PRODUCT_OWNER_VALUES] })
      .$type<ProductOwnerType>()
      .notNull()
      .default("automatize"),
    expertId: uuid("expert_id").references(() => expertProfile.id),
    slug: varchar("slug", { length: 160 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description"),
    coverUrl: text("cover_url"),
    priceCentavos: integer("price_centavos").notNull().default(0),
    currency: varchar("currency", { length: 3 }).notNull().default("brl"),
    platformFeeBasisPointsOverride: integer(
      "platform_fee_basis_points_override",
    ),
    ownerExpertShareBasisPoints: integer("expert_share_basis_points")
      .notNull()
      .default(0),
    coproducerType: varchar("coproducer_type", {
      enum: [...PRODUCT_OWNER_VALUES],
    }).$type<ProductOwnerType>(),
    coproducerExpertId: uuid("coproducer_expert_id").references(
      () => expertProfile.id,
    ),
    coproducerShareBasisPoints: integer("coproducer_share_basis_points")
      .notNull()
      .default(0),
    minimumPlanTier: varchar("minimum_plan_tier", {
      enum: [...PRODUCT_PLAN_TIER_VALUES],
    }).$type<ProductPlanTier>(),
    visibility: varchar("visibility", {
      enum: [...PRODUCT_VISIBILITY_VALUES],
    })
      .$type<ProductVisibility>()
      .notNull()
      .default("unlisted"),
    status: varchar("status", { enum: [...PRODUCT_STATUS_VALUES] })
      .$type<ProductStatus>()
      .notNull()
      .default("draft"),
    salesEnabled: boolean("sales_enabled").notNull().default(true),
    termsVersion: varchar("terms_version", { length: 40 })
      .notNull()
      .default("v1"),
    legacyMasterclassCourseId: text("legacy_masterclass_course_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    slugUnique: unique("products_slug_unique").on(table.slug),
    legacyCourseUnique: unique("products_legacy_masterclass_course_unique").on(
      table.legacyMasterclassCourseId,
    ),
    catalogIdx: index("products_catalog_idx").on(
      table.status,
      table.visibility,
      table.salesEnabled,
    ),
    expertIdx: index("products_expert_id_idx").on(table.expertId),
    coproducerExpertIdx: index("products_coproducer_expert_id_idx").on(
      table.coproducerExpertId,
    ),
    priceCheck: check("products_price_non_negative", sql`${table.priceCentavos} >= 0`),
    platformFeeOverrideCheck: check(
      "products_platform_fee_override_range",
      sql`${table.platformFeeBasisPointsOverride} IS NULL OR (${table.platformFeeBasisPointsOverride} >= 0 AND ${table.platformFeeBasisPointsOverride} <= 10000)`,
    ),
    shareCheck: check(
      "products_expert_share_range",
      sql`${table.ownerExpertShareBasisPoints} >= 0 AND ${table.ownerExpertShareBasisPoints} <= 10000 AND ${table.coproducerShareBasisPoints} >= 0 AND ${table.coproducerShareBasisPoints} <= 10000`,
    ),
    ownerCheck: check(
      "products_owner_consistency",
      sql`(${table.ownerType} = 'automatize' AND ${table.expertId} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0 AND ${table.coproducerType} IS NULL AND ${table.coproducerExpertId} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.ownerType} = 'expert' AND ${table.expertId} IS NOT NULL AND ${table.ownerExpertShareBasisPoints} + ${table.coproducerShareBasisPoints} = 10000 AND ((${table.coproducerType} IS NULL AND ${table.coproducerExpertId} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.coproducerType} = 'automatize' AND ${table.coproducerExpertId} IS NULL AND ${table.coproducerShareBasisPoints} > 0) OR (${table.coproducerType} = 'expert' AND ${table.coproducerExpertId} IS NOT NULL AND ${table.coproducerExpertId} <> ${table.expertId} AND ${table.coproducerShareBasisPoints} > 0)))`,
    ),
  }),
);

export type Product = InferSelectModel<typeof product>;

export const productContentItem = pgTable(
  "product_content_items",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    type: varchar("type", { enum: [...PRODUCT_CONTENT_TYPE_VALUES] })
      .$type<ProductContentType>()
      .notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description"),
    sourceUrl: text("source_url"),
    blobPathname: text("blob_pathname"),
    videoProvider: varchar("video_provider", { length: 30 }),
    filename: text("filename"),
    mimeType: varchar("mime_type", { length: 160 }),
    position: integer("position").notNull(),
    published: boolean("published").notNull().default(true),
    legacyMasterclassLessonId: text("legacy_masterclass_lesson_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    productPositionUnique: unique("product_content_items_position_unique").on(
      table.productId,
      table.position,
    ),
    productPublishedIdx: index("product_content_items_product_published_idx").on(
      table.productId,
      table.published,
    ),
    legacyLessonIdx: index("product_content_items_legacy_lesson_idx").on(
      table.legacyMasterclassLessonId,
    ),
    sourceCheck: check(
      "product_content_items_source_required",
      sql`${table.sourceUrl} IS NOT NULL OR ${table.blobPathname} IS NOT NULL`,
    ),
  }),
);

export type ProductContentItem = InferSelectModel<typeof productContentItem>;

export const PRODUCT_ORDER_STATUS_VALUES = [
  "pending",
  "approved",
  "failed",
  "canceled",
  "refunded",
] as const;
export type ProductOrderStatus = (typeof PRODUCT_ORDER_STATUS_VALUES)[number];

export const productOrder = pgTable(
  "product_orders",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    expertIdSnapshot: uuid("expert_id_snapshot").references(
      () => expertProfile.id,
    ),
    coproducerTypeSnapshot: varchar("coproducer_type_snapshot", {
      enum: [...PRODUCT_OWNER_VALUES],
    }).$type<ProductOwnerType>(),
    coproducerExpertIdSnapshot: uuid("coproducer_expert_id_snapshot").references(
      () => expertProfile.id,
    ),
    userId: uuid("user_id").references(() => user.id),
    acquisitionKey: varchar("acquisition_key", { length: 255 }).notNull(),
    buyerName: varchar("buyer_name", { length: 120 }).notNull(),
    buyerEmail: varchar("buyer_email", { length: 255 }).notNull(),
    buyerPhone: varchar("buyer_phone", { length: 20 }),
    productTitleSnapshot: varchar("product_title_snapshot", {
      length: 180,
    }).notNull(),
    priceCentavos: integer("price_centavos").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("brl"),
    financialModel: varchar("financial_model", {
      enum: ["legacy_net_split", "platform_fee_coproduction", "platform_fee_coproduction_v2"],
    })
      .$type<"legacy_net_split" | "platform_fee_coproduction" | "platform_fee_coproduction_v2">()
      .notNull()
      .default("legacy_net_split"),
    platformFeeBasisPoints: integer("platform_fee_basis_points"),
    ownerExpertShareBasisPoints: integer("expert_share_basis_points")
      .notNull()
      .default(0),
    coproducerShareBasisPoints: integer("coproducer_share_basis_points")
      .notNull()
      .default(0),
    termsVersion: varchar("terms_version", { length: 40 }).notNull(),
    termsAcceptedAt: timestamp("terms_accepted_at").notNull(),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    attribution: jsonb("attribution").$type<Record<string, string | null>>(),
    status: varchar("status", { enum: [...PRODUCT_ORDER_STATUS_VALUES] })
      .$type<ProductOrderStatus>()
      .notNull()
      .default("pending"),
    approvedAt: timestamp("approved_at"),
    refundedAt: timestamp("refunded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    acquisitionKeyUnique: unique("product_orders_acquisition_key_unique").on(
      table.acquisitionKey,
    ),
    productIdx: index("product_orders_product_id_idx").on(table.productId),
    userIdx: index("product_orders_user_id_idx").on(table.userId),
    buyerEmailIdx: index("product_orders_buyer_email_idx").on(table.buyerEmail),
    oneOpenPurchase: uniqueIndex("product_orders_one_open_purchase")
      .on(table.productId, table.buyerEmail)
      .where(sql`${table.status} IN ('pending', 'approved')`),
    statusCreatedIdx: index("product_orders_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    snapshotCheck: check(
      "product_orders_snapshot_consistency",
      sql`${table.priceCentavos} >= 0 AND ${table.currency} = 'brl' AND ${table.ownerExpertShareBasisPoints} >= 0 AND ${table.ownerExpertShareBasisPoints} <= 10000 AND ${table.coproducerShareBasisPoints} >= 0 AND ${table.coproducerShareBasisPoints} <= 10000 AND ((${table.financialModel} = 'legacy_net_split' AND ${table.platformFeeBasisPoints} IS NULL AND ((${table.expertIdSnapshot} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0) OR ${table.expertIdSnapshot} IS NOT NULL)) OR (${table.financialModel} = 'platform_fee_coproduction' AND ${table.platformFeeBasisPoints} >= 0 AND ${table.platformFeeBasisPoints} <= 10000 AND ((${table.expertIdSnapshot} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0) OR ${table.expertIdSnapshot} IS NOT NULL)) OR (${table.financialModel} = 'platform_fee_coproduction_v2' AND ${table.platformFeeBasisPoints} >= 0 AND ${table.platformFeeBasisPoints} <= 10000 AND ((${table.expertIdSnapshot} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0 AND ${table.coproducerTypeSnapshot} IS NULL AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.expertIdSnapshot} IS NOT NULL AND ${table.ownerExpertShareBasisPoints} + ${table.coproducerShareBasisPoints} = 10000 AND ((${table.coproducerTypeSnapshot} IS NULL AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.coproducerTypeSnapshot} = 'automatize' AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} > 0) OR (${table.coproducerTypeSnapshot} = 'expert' AND ${table.coproducerExpertIdSnapshot} IS NOT NULL AND ${table.coproducerExpertIdSnapshot} <> ${table.expertIdSnapshot} AND ${table.coproducerShareBasisPoints} > 0)))))`,
    ),
  }),
);

export type ProductOrder = InferSelectModel<typeof productOrder>;

export const productPayment = pgTable(
  "product_payments",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => productOrder.id),
    provider: varchar("provider", { length: 30 })
      .notNull()
      .default("mercadopago"),
    providerPreferenceId: varchar("provider_preference_id", { length: 255 }),
    providerPaymentId: varchar("provider_payment_id", { length: 255 }),
    status: varchar("status", {
      enum: ["pending", "approved", "failed", "refunded", "charged_back"],
    })
      .$type<"pending" | "approved" | "failed" | "refunded" | "charged_back">()
      .notNull()
      .default("pending"),
    grossAmountCentavos: integer("gross_amount_centavos"),
    netAmountCentavos: integer("net_amount_centavos"),
    feeAmountCentavos: integer("fee_amount_centavos"),
    paymentMethodId: varchar("payment_method_id", { length: 80 }),
    paymentTypeId: varchar("payment_type_id", { length: 80 }),
    providerReleaseAt: timestamp("provider_release_at"),
    platformFeeGrossCentavos: integer("platform_fee_gross_centavos"),
    platformGatewayNetRevenueCentavos: integer(
      "platform_gateway_net_revenue_centavos",
    ),
    coproductionBaseCentavos: integer("coproduction_base_centavos"),
    ownerExpertReceivableCentavos: integer("expert_receivable_centavos"),
    coproducerExpertReceivableCentavos: integer(
      "coproducer_expert_receivable_centavos",
    ),
    automatizeCoproductionRevenueCentavos: integer(
      "automatize_coproduction_revenue_centavos",
    ),
    automatizeProductRevenueCentavos: integer(
      "automatize_product_revenue_centavos",
    ),
    automatizeTotalNetRevenueCentavos: integer(
      "automatize_total_net_revenue_centavos",
    ),
    currency: varchar("currency", { length: 3 }).notNull().default("brl"),
    rawStatus: varchar("raw_status", { length: 80 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    providerPaymentUnique: uniqueIndex(
      "product_payments_provider_payment_unique",
    )
      .on(table.provider, table.providerPaymentId)
      .where(sql`${table.providerPaymentId} IS NOT NULL`),
    orderUnique: unique("product_payments_order_id_unique").on(table.orderId),
    orderIdx: index("product_payments_order_id_idx").on(table.orderId),
  }),
);

export type ProductPayment = InferSelectModel<typeof productPayment>;

export const productEntitlement = pgTable(
  "product_entitlements",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    orderId: uuid("order_id").references(() => productOrder.id),
    source: varchar("source", { enum: ["purchase", "free"] })
      .$type<"purchase" | "free">()
      .notNull(),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => ({
    activeUnique: uniqueIndex("product_entitlements_active_unique")
      .on(table.productId, table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    userIdx: index("product_entitlements_user_id_idx").on(table.userId),
    orderIdx: index("product_entitlements_order_id_idx").on(table.orderId),
  }),
);

export type ProductEntitlement = InferSelectModel<typeof productEntitlement>;

export const expertLedgerEntry = pgTable(
  "expert_ledger_entries",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => expertProfile.id),
    orderId: uuid("order_id").references(() => productOrder.id),
    eventKey: varchar("event_key", { length: 255 }).notNull(),
    type: varchar("type", {
      enum: ["sale", "refund", "chargeback", "payout"],
    })
      .$type<"sale" | "refund" | "chargeback" | "payout">()
      .notNull(),
    amountCentavos: integer("amount_centavos").notNull(),
    availableAt: timestamp("available_at"),
    description: text("description"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventKeyUnique: unique("expert_ledger_entries_event_key_unique").on(
      table.eventKey,
    ),
    expertAvailableIdx: index("expert_ledger_entries_expert_available_idx").on(
      table.expertId,
      table.availableAt,
    ),
    orderIdx: index("expert_ledger_entries_order_id_idx").on(table.orderId),
  }),
);

export type ExpertLedgerEntry = InferSelectModel<typeof expertLedgerEntry>;

export const expertPayoutRequest = pgTable(
  "expert_payout_requests",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    expertId: uuid("expert_id")
      .notNull()
      .references(() => expertProfile.id),
    amountCentavos: integer("amount_centavos").notNull(),
    pixKeySnapshot: varchar("pix_key_snapshot", { length: 255 }).notNull(),
    status: varchar("status", {
      enum: ["requested", "approved", "paid", "rejected", "canceled"],
    })
      .$type<"requested" | "approved" | "paid" | "rejected" | "canceled">()
      .notNull()
      .default("requested"),
    dueAt: timestamp("due_at").notNull(),
    proofUrl: text("proof_url"),
    adminEmail: varchar("admin_email", { length: 120 }),
    reviewedAt: timestamp("reviewed_at"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    expertStatusIdx: index("expert_payout_requests_expert_status_idx").on(
      table.expertId,
      table.status,
    ),
    oneOpenRequest: uniqueIndex("expert_payout_requests_one_open")
      .on(table.expertId)
      .where(sql`${table.status} IN ('requested', 'approved')`),
    minimumCheck: check(
      "expert_payout_requests_minimum_amount",
      sql`${table.amountCentavos} >= 10000`,
    ),
  }),
);

export type ExpertPayoutRequest = InferSelectModel<
  typeof expertPayoutRequest
>;

export const verificationToken = pgTable("verification_tokens", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  token: varchar("token", { length: 64 }).notNull().unique(),
  type: varchar("type", { length: 30 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type VerificationToken = InferSelectModel<typeof verificationToken>;

export const creditTransaction = pgTable("credit_transactions", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  amount: integer("amount").notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  description: text("description"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CreditTransaction = InferSelectModel<typeof creditTransaction>;

export const backofficeAuditLog = pgTable("backoffice_audit_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  adminEmail: varchar("admin_email", { length: 100 }).notNull(),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => user.id),
  action: varchar("action", { length: 50 }).notNull(),
  fieldName: varchar("field_name", { length: 50 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BackofficeAuditLog = InferSelectModel<typeof backofficeAuditLog>;

export const businessOperatingRules = pgTable("business_operating_rules", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: varchar("name", { length: 64 }).notNull().default("default"),
  renewalCriticalDays: integer("renewal_critical_days").notNull().default(3),
  renewalAttentionDays: integer("renewal_attention_days").notNull().default(7),
  trialCriticalDays: integer("trial_critical_days").notNull().default(1),
  trialAttentionDays: integer("trial_attention_days").notNull().default(3),
  inactivityAttentionDays: integer("inactivity_attention_days")
    .notNull()
    .default(14),
  lowCreditsThreshold: integer("low_credits_threshold").notNull().default(10),
  managedCampaignNamePrefix: varchar("managed_campaign_name_prefix", {
    length: 32,
  })
    .notNull()
    .default("[AM]"),
  activeManagedCampaignExcludesInactivity: boolean(
    "active_managed_campaign_excludes_inactivity",
  )
    .notNull()
    .default(true),
  updatedByEmail: varchar("updated_by_email", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameUnique: uniqueIndex("business_operating_rules_name_unique").on(
    table.name,
  ),
}));

export type BusinessOperatingRule = InferSelectModel<
  typeof businessOperatingRules
>;

export const businessRuleChangeLog = pgTable("business_rule_change_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => businessOperatingRules.id),
  adminEmail: varchar("admin_email", { length: 100 }).notNull(),
  fieldName: varchar("field_name", { length: 80 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type BusinessRuleChangeLog = InferSelectModel<
  typeof businessRuleChangeLog
>;

export const businessManagedCampaignCache = pgTable(
  "business_managed_campaign_cache",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    adAccountId: text("ad_account_id").notNull(),
    adAccountName: text("ad_account_name"),
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
    hasActiveManagedCampaign: boolean("has_active_managed_campaign")
      .notNull()
      .default(false),
    managedCampaignNames: jsonb("managed_campaign_names")
      .$type<string[]>()
      .notNull()
      .default([]),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userAdAccountUnique: uniqueIndex(
      "business_managed_campaign_cache_user_ad_account_unique",
    ).on(table.userId, table.adAccountId),
    userIdx: index("business_managed_campaign_cache_user_id_idx").on(
      table.userId,
    ),
  }),
);

export type BusinessManagedCampaignCache = InferSelectModel<
  typeof businessManagedCampaignCache
>;

// Company table for storing brand information
export const company = pgTable("companies", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  websiteUrl: varchar("website_url", { length: 512 }),
  instagramHandle: varchar("instagram_handle", { length: 64 }),
  industry: varchar("industry", { length: 128 }),
  niche: varchar("niche", { length: 128 }),
  subNiche: varchar("sub_niche", { length: 128 }),
  brandVoice: varchar("brand_voice", {
    enum: ["formal", "casual", "playful", "professional", "friendly"],
  }),
  targetAudience: text("target_audience"),
  brandColors: jsonb("brand_colors").$type<string[]>(),
  logoUrl: text("logo_url"),
  contentThemes: jsonb("content_themes").$type<string[]>(),
  hashtags: jsonb("hashtags").$type<string[]>(),
  preferredFormats: jsonb("preferred_formats").$type<string[]>(),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  businessPhone: varchar("business_phone", { length: 32 }),
  googlePlaceId: varchar("google_place_id", { length: 255 }),
  businessAddress: jsonb("business_address"),
  businessOperatingHours: jsonb("business_operating_hours"),
  onboardingProfileCompletedAt: timestamp("onboarding_profile_completed_at"),
  onboardingCampaignCompletedAt: timestamp("onboarding_campaign_completed_at"),
  onboardingPostCompletedAt: timestamp("onboarding_post_completed_at"),
  onboardingBrandCompletedAt: timestamp("onboarding_brand_completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Company = InferSelectModel<typeof company>;

// Physical business locations (multi-unit support per company)
export const companyLocation = pgTable(
  "company_locations",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }),
    googlePlaceId: varchar("google_place_id", { length: 255 }),
    businessPhone: varchar("business_phone", { length: 32 }),
    businessAddress: jsonb("business_address"),
    businessOperatingHours: jsonb("business_operating_hours"),
    isPrimary: boolean("is_primary").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_locations_company_id_idx").on(table.companyId),
    companyPlaceUnique: uniqueIndex("company_locations_company_place_unique").on(
      table.companyId,
      table.googlePlaceId,
    ),
  }),
);

export type CompanyLocation = InferSelectModel<typeof companyLocation>;

// User-Company relationship (multi-tenant support)
export const userCompany = pgTable(
  "user_companies",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    role: varchar("role", { enum: ["owner", "admin", "member"] })
      .notNull()
      .default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.companyId] }),
  }),
);

export type UserCompany = InferSelectModel<typeof userCompany>;

// Instagram Account table for storing Instagram account connections
export const instagramAccount = pgTable(
  "instagram_accounts",
  {
    id: text("id").primaryKey().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id").notNull(),
    instagramUserId: text("instagram_user_id"),
    username: text("username"),
    name: text("name"),
    website: text("website"),
    biography: text("biography"),
    profilePictureUrl: text("profile_picture_url"),
    mediaCount: integer("media_count"),
    accessToken: text("access_token").notNull(),
    tokenExpiresAt: timestamp("token_expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    uniqueUserAccount: unique(
      "instagram_accounts_user_id_account_id_unique",
    ).on(table.userId, table.accountId),
  }),
);

export type InstagramAccount = InferSelectModel<typeof instagramAccount>;

// Meta Business Account table for storing Facebook/BISU connections (Marketing API)
export const metaBusinessAccount = pgTable(
  "meta_business_accounts",
  {
    id: text("id").primaryKey().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    /** Legacy Facebook person ID (user-token connections). Nullable for BISU. */
    facebookUserId: text("facebook_user_id"),
    /** App-scoped BISU / system-user id from /me?fields=id,client_business_id. */
    bisuAppScopedId: text("bisu_app_scoped_id"),
    /** Client business portfolio ID from the BISU token. */
    clientBusinessId: text("client_business_id"),
    /** Display name: Facebook person (legacy) or business portfolio (BISU). */
    name: text("name"),
    pictureUrl: text("picture_url"),
    /** `user` = legacy long-lived user token; `bisu` = Business Integration System User. */
    tokenKind: varchar("token_kind", { length: 16 }).notNull().default("user"),
    /** Login for Business configuration that issued the token. */
    configId: text("config_id"),
    /** Granted scopes snapshot from debug_token (JSON string array). */
    grantedScopes: jsonb("granted_scopes").$type<string[]>(),
    /** Assigned ad accounts/pages/tasks snapshot from Graph (JSON). */
    assignedAssets: jsonb("assigned_assets").$type<{
      adAccounts?: Array<{
        id: string;
        accountId?: string;
        name?: string;
        tasks?: string[];
        businessId?: string;
      }>;
      pages?: Array<{
        id: string;
        name?: string;
        tasks?: string[];
        instagramBusinessAccountId?: string;
      }>;
    }>(),
    /** active | needs_reconnect | degraded_assets */
    connectionStatus: varchar("connection_status", { length: 32 })
      .notNull()
      .default("active"),
    lastValidatedAt: timestamp("last_validated_at"),
    lastValidationError: text("last_validation_error"),
    /** Encrypted (or legacy plaintext) access token. */
    accessToken: text("access_token").notNull(),
    /** NULL for non-expiring BISU configurations. */
    tokenExpiresAt: timestamp("token_expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    uniqueUserFacebookAccount: unique(
      "meta_business_accounts_user_id_facebook_user_id_unique",
    ).on(table.userId, table.facebookUserId),
    uniqueUserBisuBusiness: uniqueIndex(
      "meta_business_accounts_user_bisu_business_uidx",
    )
      .on(table.userId, table.clientBusinessId)
      .where(sql`${table.clientBusinessId} IS NOT NULL`),
    oneActivePerUser: uniqueIndex("meta_business_accounts_one_active_user_uidx")
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export type MetaBusinessAccount = InferSelectModel<typeof metaBusinessAccount>;

// AdSet targeting type for audit logs (subset + index for Meta targeting JSON)
export type AdSetTargetingData = {
  age_min?: number;
  age_max?: number;
  genders?: number[];
  geo_locations?: {
    countries?: string[];
    cities?: Array<{ key: string; name?: string }>;
    regions?: Array<{ key: string; name?: string }>;
    location_types?: string[];
  };
  custom_audiences?: Array<{ id: string; name?: string }>;
  excluded_custom_audiences?: Array<{ id: string; name?: string }>;
  targeting_relaxation_types?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AdSetPacingTypeData = string[] | string;

export type AdSetScheduleData = {
  days?: number[];
  start_minute?: number;
  end_minute?: number;
  timezone_type?: string;
  [key: string]: unknown;
};

export type CampaignBudgetModeData = "ABO" | "CBO";

export type CampaignEditLogSource = "user" | "admin";

export type CampaignAdSetBudgetChangeData = {
  adsetId: string;
  adsetName?: string;
  previousDailyBudget?: string | null;
  newDailyBudget?: string | null;
  previousLifetimeBudget?: string | null;
  newLifetimeBudget?: string | null;
};

export type CampaignAdSetScheduleChangeData = {
  adsetId: string;
  adsetName?: string;
  previousStartTime?: string | null;
  newStartTime?: string | null;
  previousEndTime?: string | null;
  newEndTime?: string | null;
};

// AdSet Edit Logs - tracking manual changes made by backoffice admins
// backoffice_user_email: Google OAuth admins are not in users table; store email like backoffice_audit_logs
export const adsetEditLog = pgTable("adset_edit_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  backofficeUserEmail: varchar("backoffice_user_email", {
    length: 100,
  }).notNull(),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => user.id),
  adsetId: text("adset_id").notNull(),
  accountId: text("account_id").notNull(),
  campaignId: text("campaign_id"),
  adsetName: text("adset_name"),
  previousDailyBudget: numeric("previous_daily_budget"),
  newDailyBudget: numeric("new_daily_budget"),
  previousLifetimeBudget: numeric("previous_lifetime_budget"),
  newLifetimeBudget: numeric("new_lifetime_budget"),
  previousStartTime: text("previous_start_time"),
  newStartTime: text("new_start_time"),
  previousEndTime: text("previous_end_time"),
  newEndTime: text("new_end_time"),
  previousPacingType: jsonb("previous_pacing_type").$type<AdSetPacingTypeData>(),
  newPacingType: jsonb("new_pacing_type").$type<AdSetPacingTypeData>(),
  previousAdsetSchedule: jsonb("previous_adset_schedule").$type<
    AdSetScheduleData[]
  >(),
  newAdsetSchedule: jsonb("new_adset_schedule").$type<AdSetScheduleData[]>(),
  previousTargeting: jsonb("previous_targeting").$type<AdSetTargetingData>(),
  newTargeting: jsonb("new_targeting").$type<AdSetTargetingData>(),
  note: text("note").notNull(),
  appliedToMeta: boolean("applied_to_meta").notNull().default(false),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdsetEditLog = InferSelectModel<typeof adsetEditLog>;

export const campaignEditLog = pgTable("campaign_edit_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  backofficeUserEmail: varchar("backoffice_user_email", {
    length: 100,
  }).notNull(),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => user.id),
  campaignId: text("campaign_id").notNull(),
  accountId: text("account_id").notNull(),
  campaignName: text("campaign_name"),
  previousBudgetMode: varchar("previous_budget_mode", { length: 16 })
    .$type<CampaignBudgetModeData>()
    .notNull(),
  newBudgetMode: varchar("new_budget_mode", { length: 16 })
    .$type<CampaignBudgetModeData>()
    .notNull(),
  previousDailyBudget: numeric("previous_daily_budget"),
  newDailyBudget: numeric("new_daily_budget"),
  previousLifetimeBudget: numeric("previous_lifetime_budget"),
  newLifetimeBudget: numeric("new_lifetime_budget"),
  adsetBudgetChanges: jsonb("adset_budget_changes").$type<
    CampaignAdSetBudgetChangeData[]
  >(),
  adsetScheduleChanges: jsonb("adset_schedule_changes").$type<
    CampaignAdSetScheduleChangeData[]
  >(),
  note: text("note"),
  appliedToMeta: boolean("applied_to_meta").notNull().default(false),
  errorMessage: text("error_message"),
  source: varchar("source", { length: 16 })
    .$type<CampaignEditLogSource>()
    .notNull()
    .default("admin"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CampaignEditLog = InferSelectModel<typeof campaignEditLog>;

// Ad Creative create/edit audit - backoffice admins/consultants acting on a user's behalf
export const adCreativeEditLog = pgTable("ad_creative_edit_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  backofficeUserEmail: varchar("backoffice_user_email", {
    length: 100,
  }).notNull(),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => user.id),
  accountId: text("account_id").notNull(),
  campaignId: text("campaign_id"),
  adsetId: text("adset_id").notNull(),
  operation: varchar("operation", { length: 16 }).notNull(),
  editStrategy: varchar("edit_strategy", { length: 24 }),
  sourceAdId: text("source_ad_id"),
  resultAdId: text("result_ad_id"),
  pausedAdId: text("paused_ad_id"),
  creativeId: text("creative_id"),
  mediaSource: varchar("media_source", { length: 24 }).notNull(),
  mediaKind: varchar("media_kind", { length: 12 }),
  videoId: text("video_id"),
  videoStatus: varchar("video_status", { length: 12 }),
  message: text("message"),
  appliedToMeta: boolean("applied_to_meta").notNull().default(false),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdCreativeEditLog = InferSelectModel<typeof adCreativeEditLog>;

// Scheduled posts for Instagram publishing
export const scheduledPost = pgTable(
  "scheduled_posts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    // Media source: either aiGeneratedImageId OR mediaUrl must be provided
    // For AI-generated content, use aiGeneratedImageId
    aiGeneratedImageId: uuid("ai_generated_image_id").references(
      () => generatedImage.id,
    ),
    // For uploaded/external images, use mediaUrl (fallback)
    mediaUrl: text("media_url"),
    mediaType: varchar("media_type", { length: 32 }),
    caption: text("caption"),
    locationId: text("location_id"),
    userTagsJson: text("user_tags_json"),
    scheduledAt: timestamp("scheduled_at").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    retryAttempts: integer("retry_attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at"),
    lastErrorMessage: text("last_error_message"),
    mediaContainerId: text("media_container_id"),
    mediaContainerStatus: varchar("media_container_status", { length: 32 }),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    uniqueMediaContainerId: unique(
      "scheduled_posts_media_container_id_unique",
    ).on(table.mediaContainerId),
  }),
);

export type ScheduledPost = InferSelectModel<typeof scheduledPost>;

// Post style types for food posts
export type FoodPostStyle =
  | "upgrade_estudio"
  | "com_cenario"
  | "criativo_viral"
  | "estilo_premium"
  | "close_foodporn"
  | "minimalista_premium";

// Story Turbo specific types
export type StoryStyle =
  | "close_foodporn"
  | "cenario_pro"
  | "minimalista_premium"
  | "criativo_viral";

export type TextObjective =
  | "venda_direta"
  | "interacao"
  | "lifestyle"
  | "curiosidade";

export type PostType =
  | "estilo_livre"
  | "post_do_prato"
  | "post_criativo"
  | "story_turbo"
  | "post_interativo"
  | "criador_video"
  | "campanha_whatsapp"
  | "canvas"; // Legacy canvas-based posts

// Post table for canvas-based content creation
export const post = pgTable("posts", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),

  // Canvas dimensions
  width: integer("width").notNull().default(1080),
  height: integer("height").notNull().default(1080),

  // Layers stored as JSONB (flexible & simple)
  layers: jsonb("layers").$type<Layer[]>().notNull().default([]),

  // Final rendered image (base64 or URL for storage/CDN)
  renderedImage: text("rendered_image"),
  thumbnailImage: text("thumbnail_image"),

  // Post metadata
  title: varchar("title", { length: 255 }),
  caption: text("caption"),
  status: varchar("status", {
    enum: ["draft", "ready", "scheduled", "posted", "failed"],
  })
    .$type<PostStatus>()
    .notNull()
    .default("draft"),

  // Food post specific fields (Criar Conteudo feature)
  postType: varchar("post_type", {
    enum: [
      "post_do_prato",
      "post_criativo",
      "story_turbo",
      "post_interativo",
      "criador_video",
      "campanha_whatsapp",
      "canvas",
    ],
  }).$type<PostType>(),
  sourceImage: text("source_image"), // Original uploaded image (base64)
  productName: varchar("product_name", { length: 255 }),
  postStyle: varchar("post_style", {
    enum: [
      "upgrade_estudio",
      "com_cenario",
      "criativo_viral",
      "estilo_premium",
      "close_foodporn",
      "minimalista_premium",
    ],
  }).$type<FoodPostStyle>(),

  // Story Turbo specific fields
  storyStyle: varchar("story_style", {
    enum: [
      "close_foodporn",
      "cenario_pro",
      "minimalista_premium",
      "criativo_viral",
    ],
  }).$type<StoryStyle>(),
  textObjective: varchar("text_objective", {
    enum: ["venda_direta", "interacao", "lifestyle", "curiosidade"],
  }).$type<TextObjective>(),

  // Scheduling
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),

  // Reference to scheduled post (if scheduled)
  scheduledPostId: uuid("scheduled_post_id").references(() => scheduledPost.id),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type Post = InferSelectModel<typeof post>;

// AI usage logs for tracking tokens and costs
export const aiUsageLog = pgTable("ai_usage_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),

  // Model info
  modelId: varchar("model_id", { length: 128 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(), // "google", "xai", etc.

  // Token usage
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),

  // Cost in dollars (from Vercel AI Gateway, stored as numeric for precision)
  cost: numeric("cost", { precision: 12, scale: 8 }).notNull().default("0"),

  // Duration in milliseconds
  durationMs: integer("duration_ms"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type AiUsageLog = InferSelectModel<typeof aiUsageLog>;

// Narrative types for JSONB columns
export type NarrativeOption = {
  title: string;
  description: string;
};

export type CentralTesis = {
  tesis: string;
  motherArgument: string;
  narrativeSequence: string[];
};

export type GeneratedScript =
  | {
      title: string;
      script: string;
      caption: string;
      format: "reels";
    }
  | {
      title: string;
      slides: Array<{
        slideNumber: number;
        text: string;
        visualSuggestion: string;
      }>;
      caption: string;
      format: "carrossel";
    };

// Narrative sessions for content generation wizard
export const narrativeSession = pgTable("narrative_sessions", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  subject: text("subject").notNull(),
  generatedNarratives: jsonb("generated_narratives").$type<NarrativeOption[]>(),
  selectedNarrative: jsonb("selected_narrative").$type<NarrativeOption>(),
  generatedHeadlines: jsonb("generated_headlines").$type<string[]>(),
  selectedHeadline: text("selected_headline"),
  centralTesis: jsonb("central_tesis").$type<CentralTesis>(),
  generatedScript: jsonb("generated_script").$type<GeneratedScript>(),
  contentFormat: varchar("content_format", { enum: ["reels", "carrossel"] }),
  status: varchar("status", { enum: ["draft", "completed"] })
    .notNull()
    .default("draft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type NarrativeSession = InferSelectModel<typeof narrativeSession>;

// =============================================
// AI Generated Images (Gerar Imagem feature)
// =============================================

// Aspect ratio type for generated images
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9";

// Aspect ratio dimensions mapping
export const ASPECT_RATIO_DIMENSIONS: Record<
  AspectRatio,
  { width: number; height: number; label: string }
> = {
  "1:1": { width: 1024, height: 1024, label: "Quadrado" },
  "16:9": { width: 1536, height: 864, label: "Paisagem" },
  "9:16": { width: 864, height: 1536, label: "Retrato" },
  "4:3": { width: 1152, height: 864, label: "Padrão" },
  "3:4": { width: 864, height: 1152, label: "Retrato" },
  "21:9": { width: 1536, height: 658, label: "Cinematográfico" },
};

// Generated image status
export type GeneratedImageStatus = string;

// Media type for generated images/videos
export type GeneratedMediaType = "IMAGE" | "VIDEO" | "REELS";

// Generated Images table - main record for each image/video generation session
export const generatedImage = pgTable("ai_generated_images", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),

  // Original prompt used for first generation
  prompt: text("prompt").notNull(),

  // Media type (IMAGE, VIDEO, REELS)
  mediaType: varchar("media_type", { length: 32 })
    .$type<GeneratedMediaType>()
    .notNull()
    .default("IMAGE"),

  // Aspect ratio and dimensions
  aspectRatio: varchar("aspect_ratio", {
    enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
  })
    .$type<AspectRatio>()
    .notNull()
    .default("1:1"),
  width: integer("width").notNull().default(1024),
  height: integer("height").notNull().default(1024),

  // Image URL or base64
  image: text("image"),
  publicImageUrl: text("public_image_url"),

  // Status of the generation
  status: text("status")
    .$type<GeneratedImageStatus>()
    .notNull()
    .default("generating"),

  // Link to usage log (optional)
  aiUsageLogId: uuid("ai_usage_log_id").references(() => aiUsageLog.id),

  // Position in UI lists
  position: integer("position"),

  // Error message if generation failed
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type GeneratedImage = InferSelectModel<typeof generatedImage>;

// Generated Image Versions table - tracks each version/iteration of an image
export const generatedImageVersion = pgTable(
  "ai_generated_image_versions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),

    // Version number (1-indexed, auto-incremented per image)
    versionNumber: integer("version_number").notNull().default(1),

    // Parent version used for edits (null for first version)
    parentVersionId: uuid("parent_version_id"),

    // Current image for this version
    generatedImageId: uuid("generated_image_id")
      .notNull()
      .references(() => generatedImage.id, { onDelete: "cascade" }),

    // Original image that started the edit chain
    sourceAiGeneratedImageId: uuid("source_ai_generated_image_id")
      .notNull()
      .references(() => generatedImage.id),
  },
  (table) => ({
    parentVersionRef: foreignKey({
      columns: [table.parentVersionId],
      foreignColumns: [table.id],
    }),
  }),
);

export type GeneratedImageVersion = InferSelectModel<
  typeof generatedImageVersion
>;

// Reference images used during generation/edit
export const referenceImage = pgTable("reference_images", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  imageUrl: text("image_url").notNull(),
  aiGeneratedImageId: uuid("ai_generated_image_id")
    .notNull()
    .references(() => generatedImage.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type ReferenceImage = InferSelectModel<typeof referenceImage>;

// =============================================
// AI Text Generation
// =============================================
export type AiGeneratedTextStatus = string;

export const aiGeneratedText = pgTable("ai_generated_text", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  prompt: text("prompt").notNull(),
  text: text("text"),
  aiUsageLogId: uuid("ai_usage_log_id").references(() => aiUsageLog.id),
  status: text("status")
    .$type<AiGeneratedTextStatus>()
    .notNull()
    .default("generating"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type AiGeneratedText = InferSelectModel<typeof aiGeneratedText>;

// =============================================
// Generic Generate Post (Gerar Imagem feature)
// =============================================

export const genericGeneratePost = pgTable("generic_generate_post", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  promptDescription: text("prompt_description").notNull(),
  aspectRatio: varchar("aspect_ratio", {
    enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
  })
    .$type<AspectRatio>()
    .notNull()
    .default("1:1"),
  postImageId: uuid("post_image_id")
    .notNull()
    .references(() => generatedImage.id),
  captionTextId: uuid("caption_text_id").references(() => aiGeneratedText.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type GenericGeneratePost = InferSelectModel<typeof genericGeneratePost>;

// =============================================
// Food Service Posts
// =============================================
export type CaptionObjective = string;
export type CaptionLength = string;

export const foodServicePostDoPrato = pgTable("food_service_post_do_prato", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  aiGeneratedImageId: uuid("ai_generated_image_id")
    .notNull()
    .references(() => generatedImage.id),
  productName: varchar("product_name", { length: 255 }).notNull(),
  postStyle: varchar("post_style", {
    enum: [
      "upgrade_estudio",
      "com_cenario",
      "criativo_viral",
      "estilo_premium",
      "close_foodporn",
      "minimalista_premium",
    ],
  }).$type<FoodPostStyle>(),
  captionObjective: text("caption_objective").$type<CaptionObjective>(),
  captionLength: text("caption_length").$type<CaptionLength>(),
  captionTextId: uuid("caption_text_id").references(() => aiGeneratedText.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type FoodServicePostDoPrato = InferSelectModel<
  typeof foodServicePostDoPrato
>;

export type PostCriativoCategory =
  | "noir"
  | "magic"
  | "scifi"
  | "hero"
  | "western"
  | "action"
  | "samurai"
  | "romance";

export const foodServicePostCriativo = pgTable("food_service_post_criativo", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  aiGeneratedImageId: uuid("ai_generated_image_id")
    .notNull()
    .references(() => generatedImage.id),
  productName: varchar("product_name", { length: 255 }).notNull(),
  category: varchar("category", {
    enum: [
      "noir",
      "magic",
      "scifi",
      "hero",
      "western",
      "action",
      "samurai",
      "romance",
    ],
  }).$type<PostCriativoCategory>(),
  theme: text("theme").notNull(),
  useRealisticMockup: boolean("use_realistic_mockup").notNull().default(false),
  captionTextId: uuid("caption_text_id").references(() => aiGeneratedText.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type FoodServicePostCriativo = InferSelectModel<
  typeof foodServicePostCriativo
>;

// Food Service Flyer (template-based marketing images)
export const foodServiceFlyer = pgTable("food_service_flyer", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  aiGeneratedImageId: uuid("ai_generated_image_id")
    .notNull()
    .references(() => generatedImage.id),
  templateCategory: varchar("template_category", { length: 128 }).notNull(),
  templateName: varchar("template_name", { length: 255 }).notNull(),
  productName: varchar("product_name", { length: 255 }),
  userPrompt: text("user_prompt"),
  aspectRatio: varchar("aspect_ratio", { length: 16 }),
  captionTextId: uuid("caption_text_id").references(() => aiGeneratedText.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type FoodServiceFlyer = InferSelectModel<typeof foodServiceFlyer>;

// =============================================
// Backoffice Generated Posts
// =============================================

export const backofficeGeneratedPost = pgTable("backoffice_generated_posts", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  backofficeUserId: uuid("backoffice_user_id")
    .notNull()
    .references(() => user.id),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => user.id),
  sourceUserGeneratedImageId: uuid("source_user_generated_image_id").references(
    () => generatedImage.id,
  ),
  sourceBackofficePostId: uuid("source_backoffice_post_id"),
  prompt: text("prompt").notNull(),
  generatedImageId: uuid("generated_image_id").references(
    () => generatedImage.id,
  ),
  captionTextId: uuid("caption_text_id").references(() => aiGeneratedText.id),
  referenceImageUrls: jsonb("reference_image_urls")
    .$type<string[]>()
    .default([]),
  aspectRatio: varchar("aspect_ratio", { length: 10 }).default("1:1"),
  status: varchar("status", { length: 32 }).notNull().default("generating"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type BackofficeGeneratedPost = InferSelectModel<
  typeof backofficeGeneratedPost
>;

// =============================================
// Video Templates (Creatomate)
// =============================================

export type VideoTemplateStatus = "active" | "inactive";

export const videoTemplate = pgTable("video_templates", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  videoPreviewUrl: text("video_preview_url"),
  category: varchar("category", { length: 128 }),
  position: integer("position").notNull().default(0),
  status: varchar("status", { enum: ["active", "inactive"] })
    .$type<VideoTemplateStatus>()
    .notNull()
    .default("inactive"),
  creatomateTemplateId: varchar("creatomate_template_id", { length: 255 }).notNull(),
  // O nome do elemento de vídeo cru (ex: "Video-1") no template do Creatomate
  videoSourceKey: varchar("video_source_key", { length: 128 }).notNull().default("Video-1"),
  maxDuration: integer("max_duration"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type VideoTemplate = InferSelectModel<typeof videoTemplate>;

// =============================================
// Stripe Subscription Management
// =============================================

// Plan type enum - compound: {period}_{tier}
export const PLAN_TYPE_VALUES = [
  "monthly_starter",
  "monthly_pro",
  "monthly_premium",
  "quarterly_starter",
  "quarterly_pro",
  "quarterly_premium",
  "semiannual_starter",
  "semiannual_pro",
  "semiannual_premium",
  "annual_starter",
  "annual_pro",
  "annual_premium",
] as const;

export type PlanType = (typeof PLAN_TYPE_VALUES)[number];

export const BILLING_PROVIDER_VALUES = [
  "stripe",
  "mercadopago",
  "manual",
] as const;

export type BillingProvider = (typeof BILLING_PROVIDER_VALUES)[number];

// Subscription status enum (mirrors Stripe)
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "expired";

// Subscriptions table - tracks Stripe subscription records
export const subscription = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    provider: varchar("provider", {
      enum: [...BILLING_PROVIDER_VALUES],
    })
      .$type<BillingProvider>()
      .notNull()
      .default("stripe"),
    stripeSubscriptionId: varchar("stripe_subscription_id", {
      length: 255,
    }),
    stripePriceId: varchar("stripe_price_id", { length: 255 }),
    planType: varchar("plan_type", {
      enum: [...PLAN_TYPE_VALUES],
    })
      .$type<PlanType>()
      .notNull(),
    status: varchar("status", {
      enum: [
        "active",
        "past_due",
        "canceled",
        "unpaid",
        "incomplete",
        "incomplete_expired",
        "trialing",
        "expired",
      ],
    })
      .$type<SubscriptionStatus>()
      .notNull(),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at"),
    endedAt: timestamp("ended_at"),
    // End of the current commitment cycle (months×N from start). Drives
    // deferred cancellation and post-commitment auto-renewal. NULL only for
    // legacy rows pre-migration; populated by checkout flow for new subs.
    commitmentEndDate: timestamp("commitment_end_date"),
    // How many months the user committed to in the current cycle (1, 3, 6, 12).
    commitmentMonths: integer("commitment_months").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueStripeSubscriptionId: uniqueIndex(
      "subscriptions_stripe_subscription_id_unique",
    )
      .on(table.stripeSubscriptionId)
      .where(sql`${table.stripeSubscriptionId} IS NOT NULL`),
  }),
);

export type Subscription = InferSelectModel<typeof subscription>;

// Pending plan changes - stores scheduled plan changes
export type PlanChangeType = "upgrade" | "downgrade" | "plan_change";
export type PendingPlanChangeStatus = "pending" | "applied" | "canceled";

export const pendingPlanChange = pgTable("pending_plan_changes", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => subscription.id),
  currentPlanType: varchar("current_plan_type", {
    enum: [...PLAN_TYPE_VALUES],
  })
    .$type<PlanType>()
    .notNull(),
  newPlanType: varchar("new_plan_type", {
    enum: [...PLAN_TYPE_VALUES],
  })
    .$type<PlanType>()
    .notNull(),
  newStripePriceId: varchar("new_stripe_price_id", { length: 255 }).notNull(),
  changeType: varchar("change_type", {
    enum: ["upgrade", "downgrade", "plan_change"],
  })
    .$type<PlanChangeType>()
    .notNull(),
  effectiveDate: timestamp("effective_date").notNull(),
  status: varchar("status", {
    enum: ["pending", "applied", "canceled"],
  })
    .$type<PendingPlanChangeStatus>()
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PendingPlanChange = InferSelectModel<typeof pendingPlanChange>;

// Payments table - payment history records
export type PaymentStatus = "succeeded" | "failed" | "pending" | "refunded";

// How a settled payment was reversed. `refund` is money the merchant gave back;
// `chargeback` is money the card network pulled back after a dispute. Both are
// recorded here, on the payment, because the affiliate program reads reversals
// from `payments` and never from a gateway SDK (ADR 0025).
export type PaymentReversalKind = "refund" | "chargeback";

export const payment = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    subscriptionId: uuid("subscription_id").references(() => subscription.id),
    stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    stripeChargeId: varchar("stripe_charge_id", { length: 255 }),
    provider: varchar("provider", {
      enum: [...BILLING_PROVIDER_VALUES],
    })
      .$type<BillingProvider>()
      .notNull()
      .default("stripe"),
    mercadopagoPaymentId: varchar("mercadopago_payment_id", { length: 255 }),
    mercadopagoPreferenceId: varchar("mercadopago_preference_id", {
      length: 255,
    }),
    amount: integer("amount").notNull(),
    grossAmount: integer("gross_amount"),
    netAmount: integer("net_amount"),
    feeAmount: integer("fee_amount"),
    currency: varchar("currency", { length: 10 }).notNull(),
    status: varchar("status", {
      enum: ["succeeded", "failed", "pending", "refunded"],
    })
      .$type<PaymentStatus>()
      .notNull(),
    planType: varchar("plan_type", {
      enum: [...PLAN_TYPE_VALUES],
    })
      .$type<PlanType>()
      .notNull(),
    description: text("description"),
    failureReason: text("failure_reason"),
    paidAt: timestamp("paid_at"),
    // Reversal, in centavos. Always written even when it equals the gross,
    // because it is what lets an anomalous PARTIAL refund be detected — the
    // business policy is that a refund is always total.
    refundedAmount: integer("refunded_amount"),
    refundedAt: timestamp("refunded_at"),
    reversalKind: varchar("reversal_kind", {
      enum: ["refund", "chargeback"],
    }).$type<PaymentReversalKind>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueStripeInvoiceId: unique("payments_stripe_invoice_id_unique").on(
      table.stripeInvoiceId,
    ),
    uniqueMercadopagoPaymentId: unique(
      "payments_mercadopago_payment_id_unique",
    ).on(table.mercadopagoPaymentId),
  }),
);

export type Payment = InferSelectModel<typeof payment>;

// Subscription events - audit log
export type SubscriptionEventType =
  | "subscribed"
  | "renewed"
  | "upgraded"
  | "downgraded"
  | "plan_changed"
  | "canceled"
  | "reactivated"
  | "expired"
  | "payment_failed"
  | "payment_recovered";

export const subscriptionEvent = pgTable("subscription_events", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  subscriptionId: uuid("subscription_id").references(() => subscription.id),
  eventType: varchar("event_type", {
    enum: [
      "subscribed",
      "renewed",
      "upgraded",
      "downgraded",
      "plan_changed",
      "canceled",
      "reactivated",
      "expired",
      "payment_failed",
      "payment_recovered",
    ],
  })
    .$type<SubscriptionEventType>()
    .notNull(),
  fromPlan: varchar("from_plan", {
    enum: [...PLAN_TYPE_VALUES],
  }).$type<PlanType>(),
  toPlan: varchar("to_plan", {
    enum: [...PLAN_TYPE_VALUES],
  }).$type<PlanType>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SubscriptionEvent = InferSelectModel<typeof subscriptionEvent>;

// Processed webhook events - for idempotency
export const processedWebhookEvent = pgTable(
  "processed_webhook_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueStripeEventId: unique(
      "processed_webhook_events_stripe_event_id_unique",
    ).on(table.stripeEventId),
  }),
);

export type ProcessedWebhookEvent = InferSelectModel<
  typeof processedWebhookEvent
>;

export type MercadoPagoPaymentLinkStatus =
  | "pending"
  | "approved"
  | "expired"
  | "canceled";

export type MercadoPagoPaymentLinkSource =
  | "self_service"
  | "backoffice"
  | "renewal_email";

export const mercadopagoPaymentLink = pgTable(
  "mercadopago_payment_links",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    planType: varchar("plan_type", {
      enum: [...PLAN_TYPE_VALUES],
    })
      .$type<PlanType>()
      .notNull(),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 10 }).notNull().default("brl"),
    preferenceId: varchar("preference_id", { length: 255 }).notNull(),
    initPoint: text("init_point").notNull(),
    status: varchar("status", {
      enum: ["pending", "approved", "expired", "canceled"],
    })
      .$type<MercadoPagoPaymentLinkStatus>()
      .notNull()
      .default("pending"),
    source: varchar("source", {
      enum: ["self_service", "backoffice", "renewal_email"],
    })
      .$type<MercadoPagoPaymentLinkSource>()
      .notNull(),
    adminEmail: varchar("admin_email", { length: 100 }),
    expiresAt: timestamp("expires_at").notNull(),
    paidAt: timestamp("paid_at"),
    mercadopagoPaymentId: varchar("mercadopago_payment_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniquePreferenceId: unique(
      "mercadopago_payment_links_preference_id_unique",
    ).on(table.preferenceId),
  }),
);

export type MercadoPagoPaymentLink = InferSelectModel<
  typeof mercadopagoPaymentLink
>;

export type BillingNotificationType = "expiration_3d" | "expiration_1d";

export const billingNotificationDelivery = pgTable(
  "billing_notification_deliveries",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    subscriptionId: uuid("subscription_id").references(() => subscription.id),
    notificationType: varchar("notification_type", {
      enum: ["expiration_3d", "expiration_1d"],
    })
      .$type<BillingNotificationType>()
      .notNull(),
    expirationDate: timestamp("expiration_date").notNull(),
    mercadopagoPaymentLinkId: uuid("mercadopago_payment_link_id").references(
      () => mercadopagoPaymentLink.id,
    ),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueDelivery: unique(
      "billing_notification_deliveries_user_type_expiration_unique",
    ).on(table.userId, table.notificationType, table.expirationDate),
  }),
);

export type BillingNotificationDelivery = InferSelectModel<
  typeof billingNotificationDelivery
>;

// Plan price configs - allows price changes without redeployment
export const planPriceConfig = pgTable("plan_price_configs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  planType: varchar("plan_type", {
    enum: [...PLAN_TYPE_VALUES],
  })
    .$type<PlanType>()
    .notNull(),
  stripePriceId: varchar("stripe_price_id", { length: 255 }).notNull(),
  amount: integer("amount").notNull(),
  currency: varchar("currency", { length: 10 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PlanPriceConfig = InferSelectModel<typeof planPriceConfig>;

// =============================================
// Affiliate System
// =============================================

export type AffiliateStatus = "pending" | "approved" | "rejected" | "blocked";

export const affiliate = pgTable("affiliates", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id)
    .unique(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  status: varchar("status", {
    enum: ["pending", "approved", "rejected", "blocked"],
  })
    .$type<AffiliateStatus>()
    .notNull()
    .default("pending"),
  stripeCouponId: varchar("stripe_coupon_id", { length: 255 }),
  stripePromotionCodeId: varchar("stripe_promotion_code_id", { length: 255 }),
  commissionRate: integer("commission_rate").notNull().default(10),
  approvedBy: varchar("approved_by", { length: 100 }),
  approvedAt: timestamp("approved_at"),
  rejectedBy: varchar("rejected_by", { length: 100 }),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  blockedBy: varchar("blocked_by", { length: 100 }),
  blockedAt: timestamp("blocked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Affiliate = InferSelectModel<typeof affiliate>;

export type AffiliateActionType =
  | "approved"
  | "rejected"
  | "blocked"
  | "reactivated"
  | "code_edited";

export const affiliateActionLog = pgTable("affiliate_action_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  affiliateId: uuid("affiliate_id")
    .notNull()
    .references(() => affiliate.id),
  adminEmail: varchar("admin_email", { length: 100 }).notNull(),
  action: varchar("action", {
    enum: ["approved", "rejected", "blocked", "reactivated", "code_edited"],
  })
    .$type<AffiliateActionType>()
    .notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AffiliateActionLog = InferSelectModel<typeof affiliateActionLog>;

export const affiliateClick = pgTable("affiliate_clicks", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  affiliateId: uuid("affiliate_id")
    .notNull()
    .references(() => affiliate.id),
  ipHash: varchar("ip_hash", { length: 64 }),
  userAgent: text("user_agent"),
  referrerUrl: text("referrer_url"),
  landingUrl: text("landing_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AffiliateClick = InferSelectModel<typeof affiliateClick>;

export type AffiliateConversionStatus =
  | "pending"
  | "approved"
  | "paid"
  | "rejected";

export const affiliateConversion = pgTable("affiliate_conversions", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  affiliateId: uuid("affiliate_id")
    .notNull()
    .references(() => affiliate.id),
  convertedUserId: uuid("converted_user_id")
    .notNull()
    .references(() => user.id),
  subscriptionId: uuid("subscription_id").references(() => subscription.id),
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
  amount: integer("amount").notNull(),
  commissionAmount: integer("commission_amount").notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("brl"),
  status: varchar("status", {
    enum: ["pending", "approved", "paid", "rejected"],
  })
    .$type<AffiliateConversionStatus>()
    .notNull()
    .default("pending"),
  approvedAt: timestamp("approved_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AffiliateConversion = InferSelectModel<typeof affiliateConversion>;

// =============================================
// Programa de afiliados v2 — namespace `referral_*`
//
// Deliberadamente separado das tabelas do v1 acima (`affiliates`,
// `affiliate_clicks`, `affiliate_conversions`, `affiliate_action_logs`) e da
// coluna `users.referred_by_affiliate_id`, que permanecem no banco intactas e
// sem uso. Lendo o banco, o prefixo é o que diz qual conjunto está vivo
// (ADR 0024). Nenhum dado do v1 é migrado ou reinterpretado.
//
// Dinheiro é sempre centavos em `integer`. Manter byte-equivalente com o
// `lib/db/schema.ts` do projeto irmão — os dois descrevem o mesmo Postgres.
// =============================================

export const REFERRAL_ATTRIBUTION_MODEL_VALUES = ["last_click"] as const;
export type ReferralAttributionModel =
  (typeof REFERRAL_ATTRIBUTION_MODEL_VALUES)[number];

export const REFERRAL_AFFILIATE_STATUS_VALUES = [
  "pending",
  "approved",
  "rejected",
  "blocked",
] as const;
export type ReferralAffiliateStatus =
  (typeof REFERRAL_AFFILIATE_STATUS_VALUES)[number];

export const REFERRAL_TAX_DOCUMENT_TYPE_VALUES = ["cpf", "cnpj"] as const;
export type ReferralTaxDocumentType =
  (typeof REFERRAL_TAX_DOCUMENT_TYPE_VALUES)[number];

export const REFERRAL_AGREEMENT_FORMAT_VALUES = [
  "percentage",
  "fixed",
] as const;
export type ReferralAgreementFormat =
  (typeof REFERRAL_AGREEMENT_FORMAT_VALUES)[number];

// Só aceita `net`. A base de cálculo é global e é o líquido: a empresa nunca
// paga comissão sobre dinheiro que não entrou (ADR 0026). O campo existe para
// tornar a decisão legível no banco, não para ser configurado.
export const REFERRAL_CALCULATION_BASE_VALUES = ["net"] as const;
export type ReferralCalculationBase =
  (typeof REFERRAL_CALCULATION_BASE_VALUES)[number];

export const REFERRAL_AGREEMENT_DURATION_VALUES = [
  "lifetime",
  "n_cycles",
  "first_sale",
] as const;
export type ReferralAgreementDuration =
  (typeof REFERRAL_AGREEMENT_DURATION_VALUES)[number];

export const REFERRAL_ATTRIBUTION_OUTCOME_VALUES = [
  "won",
  "lost_last_click",
  "lost_permanent_link",
  "lost_existing_account",
  "lost_self_referral",
] as const;
export type ReferralAttributionOutcome =
  (typeof REFERRAL_ATTRIBUTION_OUTCOME_VALUES)[number];

export const REFERRAL_EVENT_KIND_VALUES = [
  "sale",
  "renewal",
  "reversal",
] as const;
export type ReferralEventKind = (typeof REFERRAL_EVENT_KIND_VALUES)[number];

export const REFERRAL_EVENT_STATUS_VALUES = [
  "awaiting_settlement",
  "settled",
  "ignored",
] as const;
export type ReferralEventStatus = (typeof REFERRAL_EVENT_STATUS_VALUES)[number];

export const REFERRAL_COMMISSION_STATUS_VALUES = [
  "foreseen",
  "approved",
  "paid",
  "reversed",
  "rejected",
] as const;
export type ReferralCommissionStatus =
  (typeof REFERRAL_COMMISSION_STATUS_VALUES)[number];

export const REFERRAL_LEDGER_ENTRY_TYPE_VALUES = [
  "commission",
  "reversal",
  "payout",
  "write_off",
] as const;
export type ReferralLedgerEntryType =
  (typeof REFERRAL_LEDGER_ENTRY_TYPE_VALUES)[number];

export const REFERRAL_PAYOUT_STATUS_VALUES = [
  "requested",
  "approved",
  "paid",
  "denied",
  "cancelled",
] as const;
export type ReferralPayoutStatus =
  (typeof REFERRAL_PAYOUT_STATUS_VALUES)[number];

export const REFERRAL_ADMIN_ACTION_VALUES = [
  "affiliate_approved",
  "affiliate_rejected",
  "affiliate_blocked",
  "affiliate_reactivated",
  "agreement_created",
  "agreement_renegotiated",
  "payout_approved",
  "payout_paid",
  "payout_denied",
  "balance_written_off",
] as const;
export type ReferralAdminActionType =
  (typeof REFERRAL_ADMIN_ACTION_VALUES)[number];

/** Snapshot da regra que produziu uma Comissão. Nunca reprecificado. */
export type ReferralAgreementSnapshot = {
  format: ReferralAgreementFormat;
  percentageBps: number | null;
  fixedAmountCentavos: number | null;
  calculationBase: ReferralCalculationBase;
  duration: ReferralAgreementDuration;
  durationCycles: number | null;
};

/**
 * Configuração do Programa — versionada, com exatamente uma linha vigente
 * (índice único parcial). Janela de atribuição, carência e mínimo de saque são
 * globais e nunca termos de um acordo individual. Cada Atribuição grava a
 * versão vigente, que é o que mantém o histórico explicável quando a política
 * muda.
 */
export const referralProgramConfig = pgTable(
  "referral_program_config",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    version: integer("version").notNull(),
    attributionWindowDays: integer("attribution_window_days").notNull(),
    waitingPeriodDays: integer("waiting_period_days").notNull(),
    minPayoutCentavos: integer("min_payout_centavos").notNull(),
    attributionModel: varchar("attribution_model", {
      enum: [...REFERRAL_ATTRIBUTION_MODEL_VALUES],
    })
      .$type<ReferralAttributionModel>()
      .notNull()
      .default("last_click"),
    effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
    supersededAt: timestamp("superseded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    versionUnique: unique("referral_program_config_version_unique").on(
      table.version,
    ),
    oneCurrent: uniqueIndex("referral_program_config_one_current")
      .on(sql`((${table.supersededAt} IS NULL))`)
      .where(sql`${table.supersededAt} IS NULL`),
  }),
);

export type ReferralProgramConfig = InferSelectModel<
  typeof referralProgramConfig
>;

/**
 * Afiliado — sempre lastreado numa conta de usuário, mas nunca obrigado a ser
 * assinante. Carrega exatamente um código, gerado no v2 (nenhuma string do v1
 * é portada). O documento fiscal é nulo até o primeiro saque.
 */
export const referralAffiliate = pgTable(
  "referral_affiliates",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id)
      .unique(),
    code: varchar("code", { length: 32 }).notNull().unique(),
    status: varchar("status", {
      enum: [...REFERRAL_AFFILIATE_STATUS_VALUES],
    })
      .$type<ReferralAffiliateStatus>()
      .notNull()
      .default("pending"),
    taxDocument: varchar("tax_document", { length: 20 }),
    taxDocumentType: varchar("tax_document_type", {
      enum: [...REFERRAL_TAX_DOCUMENT_TYPE_VALUES],
    }).$type<ReferralTaxDocumentType>(),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    approvedBy: varchar("approved_by", { length: 120 }),
    approvedAt: timestamp("approved_at"),
    rejectedBy: varchar("rejected_by", { length: 120 }),
    rejectedAt: timestamp("rejected_at"),
    rejectionReason: text("rejection_reason"),
    blockedBy: varchar("blocked_by", { length: 120 }),
    blockedAt: timestamp("blocked_at"),
    blockReason: text("block_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("referral_affiliates_status_idx").on(table.status),
  }),
);

export type ReferralAffiliate = InferSelectModel<typeof referralAffiliate>;

/**
 * Acordo de Comissão — formato, valor e duração, e nada mais: carência e base
 * de cálculo são globais. Um acordo vigente por afiliado, garantido por índice
 * único parcial. Acordos superados nunca são apagados, porque são o que
 * explica as comissões passadas.
 */
export const referralAgreement = pgTable(
  "referral_agreements",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    format: varchar("format", {
      enum: [...REFERRAL_AGREEMENT_FORMAT_VALUES],
    })
      .$type<ReferralAgreementFormat>()
      .notNull(),
    percentageBps: integer("percentage_bps"),
    fixedAmountCentavos: integer("fixed_amount_centavos"),
    calculationBase: varchar("calculation_base", {
      enum: [...REFERRAL_CALCULATION_BASE_VALUES],
    })
      .$type<ReferralCalculationBase>()
      .notNull()
      .default("net"),
    duration: varchar("duration", {
      enum: [...REFERRAL_AGREEMENT_DURATION_VALUES],
    })
      .$type<ReferralAgreementDuration>()
      .notNull()
      .default("lifetime"),
    durationCycles: integer("duration_cycles"),
    effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
    supersededAt: timestamp("superseded_at"),
    createdBy: varchar("created_by", { length: 120 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    oneCurrentPerAffiliate: uniqueIndex("referral_agreements_one_current")
      .on(table.affiliateId)
      .where(sql`${table.supersededAt} IS NULL`),
    affiliateIdx: index("referral_agreements_affiliate_effective_idx").on(
      table.affiliateId,
      table.effectiveFrom,
    ),
    formatCheck: check(
      "referral_agreements_format_value",
      sql`(${table.format} = 'percentage' AND ${table.percentageBps} IS NOT NULL AND ${table.fixedAmountCentavos} IS NULL)
        OR (${table.format} = 'fixed' AND ${table.fixedAmountCentavos} IS NOT NULL AND ${table.percentageBps} IS NULL)`,
    ),
    durationCheck: check(
      "referral_agreements_duration_cycles",
      sql`(${table.duration} = 'n_cycles' AND ${table.durationCycles} IS NOT NULL AND ${table.durationCycles} > 0)
        OR (${table.duration} <> 'n_cycles' AND ${table.durationCycles} IS NULL)`,
    ),
  }),
);

export type ReferralAgreement = InferSelectModel<typeof referralAgreement>;

/**
 * Indicado — conta cuja origem foi congelada no cadastro. Aponta
 * explicitamente para o acordo que a rege, e não por data: é este campo que a
 * renegociação reescreve, ou não, por escolha do operador. O vínculo com o
 * afiliado é permanente.
 */
export const referralCustomer = pgTable(
  "referral_customers",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id)
      .unique(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => referralAgreement.id),
    signedUpAt: timestamp("signed_up_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    affiliateIdx: index("referral_customers_affiliate_idx").on(
      table.affiliateId,
    ),
    agreementIdx: index("referral_customers_agreement_idx").on(
      table.agreementId,
    ),
  }),
);

export type ReferralCustomer = InferSelectModel<typeof referralCustomer>;

/**
 * Clique — uma chegada carregando o código do afiliado na URL. Toda chegada
 * conta; o parâmetro é limpo da URL depois da captura. O `visitor_id` anônimo
 * é o que liga o clique ao cadastro que ele produziu.
 */
export const referralClick = pgTable(
  "referral_clicks",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    visitorId: uuid("visitor_id").notNull(),
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: text("user_agent"),
    referrerUrl: text("referrer_url"),
    landingUrl: text("landing_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    visitorIdx: index("referral_clicks_visitor_created_idx").on(
      table.visitorId,
      table.createdAt,
    ),
    affiliateIdx: index("referral_clicks_affiliate_created_idx").on(
      table.affiliateId,
      table.createdAt,
    ),
  }),
);

export type ReferralClick = InferSelectModel<typeof referralClick>;

/**
 * Atribuição — uma linha por toque, vencedor e perdedores, cada um com o
 * motivo da derrota e a versão da configuração vigente. `customer_id` só é
 * preenchido no toque vencedor: um toque que perdeu para conta já existente
 * não produz Indicado nenhum. O índice parcial garante um único vencedor por
 * conta.
 */
export const referralAttribution = pgTable(
  "referral_attributions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    customerId: uuid("customer_id").references(() => referralCustomer.id),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    clickId: uuid("click_id")
      .notNull()
      .references(() => referralClick.id),
    outcome: varchar("outcome", {
      enum: [...REFERRAL_ATTRIBUTION_OUTCOME_VALUES],
    })
      .$type<ReferralAttributionOutcome>()
      .notNull(),
    reason: text("reason"),
    configVersion: integer("config_version").notNull(),
    resolvedAt: timestamp("resolved_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    oneWinnerPerUser: uniqueIndex("referral_attributions_one_winner")
      .on(table.userId)
      .where(sql`${table.outcome} = 'won'`),
    userIdx: index("referral_attributions_user_idx").on(table.userId),
    affiliateOutcomeIdx: index(
      "referral_attributions_affiliate_outcome_idx",
    ).on(table.affiliateId, table.outcome),
  }),
);

export type ReferralAttribution = InferSelectModel<typeof referralAttribution>;

/**
 * Evento Comissionável — uma fatura de assinatura paga, de qualquer gateway,
 * derivada de `payments` e nunca de um SDK. Idempotente por `event_key`, que
 * deriva da identidade do pagamento no provedor (e não de `payments.id`,
 * porque a mesma linha muda de `failed` para `succeeded` num Smart Retry).
 * Sem líquido o evento fica em `awaiting_settlement` e não produz Comissão
 * nenhuma — o CHECK abaixo é o que impede um evento liquidado sem líquido.
 */
export const referralCommissionableEvent = pgTable(
  "referral_commissionable_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payment.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => referralCustomer.id),
    eventKey: varchar("event_key", { length: 255 }).notNull(),
    kind: varchar("kind", {
      enum: [...REFERRAL_EVENT_KIND_VALUES],
    })
      .$type<ReferralEventKind>()
      .notNull(),
    status: varchar("status", {
      enum: [...REFERRAL_EVENT_STATUS_VALUES],
    })
      .$type<ReferralEventStatus>()
      .notNull()
      .default("awaiting_settlement"),
    grossCentavos: integer("gross_centavos").notNull(),
    netCentavos: integer("net_centavos"),
    occurredAt: timestamp("occurred_at").notNull(),
    settledAt: timestamp("settled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventKeyUnique: unique(
      "referral_commissionable_events_event_key_unique",
    ).on(table.eventKey),
    paymentIdx: index("referral_commissionable_events_payment_idx").on(
      table.paymentId,
    ),
    customerIdx: index("referral_commissionable_events_customer_idx").on(
      table.customerId,
    ),
    statusOccurredIdx: index(
      "referral_commissionable_events_status_occurred_idx",
    ).on(table.status, table.occurredAt),
    settledNeedsNet: check(
      "referral_commissionable_events_settled_needs_net",
      sql`${table.status} <> 'settled' OR ${table.netCentavos} IS NOT NULL`,
    ),
  }),
);

export type ReferralCommissionableEvent = InferSelectModel<
  typeof referralCommissionableEvent
>;

/**
 * Comissão — o valor devido por um Evento Comissionável, com o snapshot da
 * regra que o produziu. Percentual incide sobre o líquido. Ciclo de vida:
 * `foreseen` → `approved` → `paid`, com `reversed` e `rejected` alcançáveis de
 * qualquer ponto.
 */
export const referralCommission = pgTable(
  "referral_commissions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => referralCommissionableEvent.id),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => referralAgreement.id),
    agreementSnapshot: jsonb("agreement_snapshot")
      .$type<ReferralAgreementSnapshot>()
      .notNull(),
    amountCentavos: integer("amount_centavos").notNull(),
    status: varchar("status", {
      enum: [...REFERRAL_COMMISSION_STATUS_VALUES],
    })
      .$type<ReferralCommissionStatus>()
      .notNull()
      .default("foreseen"),
    releasesAt: timestamp("releases_at").notNull(),
    releasedAt: timestamp("released_at"),
    reversedAt: timestamp("reversed_at"),
    rejectedAt: timestamp("rejected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    eventUnique: unique("referral_commissions_event_unique").on(table.eventId),
    affiliateStatusIdx: index("referral_commissions_affiliate_status_idx").on(
      table.affiliateId,
      table.status,
    ),
    releaseIdx: index("referral_commissions_status_releases_idx").on(
      table.status,
      table.releasesAt,
    ),
    amountCheck: check(
      "referral_commissions_amount_non_negative",
      sql`${table.amountCentavos} >= 0`,
    ),
  }),
);

export type ReferralCommission = InferSelectModel<typeof referralCommission>;

/**
 * Solicitação de Saque. Duas travas vivem no banco, não na aplicação: um
 * pedido aberto (`requested | approved`) por afiliado, e o mínimo de R$100.
 * Uma corrida de requisições não pode pagar em dobro, e essa garantia é do
 * Postgres. Guarda o snapshot do documento fiscal usado no momento do pedido.
 */
export const referralPayoutRequest = pgTable(
  "referral_payout_requests",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    amountCentavos: integer("amount_centavos").notNull(),
    taxDocumentSnapshot: varchar("tax_document_snapshot", {
      length: 20,
    }).notNull(),
    taxDocumentTypeSnapshot: varchar("tax_document_type_snapshot", {
      enum: [...REFERRAL_TAX_DOCUMENT_TYPE_VALUES],
    })
      .$type<ReferralTaxDocumentType>()
      .notNull(),
    status: varchar("status", {
      enum: [...REFERRAL_PAYOUT_STATUS_VALUES],
    })
      .$type<ReferralPayoutStatus>()
      .notNull()
      .default("requested"),
    adminEmail: varchar("admin_email", { length: 120 }),
    proofUrl: text("proof_url"),
    denialReason: text("denial_reason"),
    reviewedAt: timestamp("reviewed_at"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    affiliateStatusIdx: index(
      "referral_payout_requests_affiliate_status_idx",
    ).on(table.affiliateId, table.status),
    oneOpenRequest: uniqueIndex("referral_payout_requests_one_open")
      .on(table.affiliateId)
      .where(sql`${table.status} IN ('requested', 'approved')`),
    minimumCheck: check(
      "referral_payout_requests_minimum_amount",
      sql`${table.amountCentavos} >= 10000`,
    ),
  }),
);

export type ReferralPayoutRequest = InferSelectModel<
  typeof referralPayoutRequest
>;

/**
 * Lançamento — espelha `expert_ledger_entries`, o padrão já provado no repo:
 * valor com sinal, tipo, `event_key` único para idempotência e origem
 * rastreável. Nunca sofre `UPDATE`: uma correção é um lançamento oposto.
 *
 * `available_at` carrega a carência (nulo = disponível imediatamente, como um
 * saque pago ou uma baixa). `customer_id` é o que faz um lançamento de
 * reversão dizer qual indicado o originou, para que um débito no extrato
 * nunca seja um mistério.
 */
export const referralLedgerEntry = pgTable(
  "referral_ledger_entries",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    type: varchar("type", {
      enum: [...REFERRAL_LEDGER_ENTRY_TYPE_VALUES],
    })
      .$type<ReferralLedgerEntryType>()
      .notNull(),
    amountCentavos: integer("amount_centavos").notNull(),
    eventKey: varchar("event_key", { length: 255 }).notNull(),
    commissionId: uuid("commission_id").references(() => referralCommission.id),
    payoutRequestId: uuid("payout_request_id").references(
      () => referralPayoutRequest.id,
    ),
    customerId: uuid("customer_id").references(() => referralCustomer.id),
    availableAt: timestamp("available_at"),
    description: text("description"),
    createdBy: varchar("created_by", { length: 120 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventKeyUnique: unique("referral_ledger_entries_event_key_unique").on(
      table.eventKey,
    ),
    affiliateAvailableIdx: index(
      "referral_ledger_entries_affiliate_available_idx",
    ).on(table.affiliateId, table.availableAt),
    commissionIdx: index("referral_ledger_entries_commission_idx").on(
      table.commissionId,
    ),
    payoutIdx: index("referral_ledger_entries_payout_idx").on(
      table.payoutRequestId,
    ),
  }),
);

export type ReferralLedgerEntry = InferSelectModel<typeof referralLedgerEntry>;

/** Log de ação administrativa do programa — quem fez, em quem, e o quê. */
export const referralAdminAction = pgTable(
  "referral_admin_actions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    adminEmail: varchar("admin_email", { length: 120 }).notNull(),
    action: varchar("action", {
      enum: [...REFERRAL_ADMIN_ACTION_VALUES],
    })
      .$type<ReferralAdminActionType>()
      .notNull(),
    reason: text("reason"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    affiliateCreatedIdx: index(
      "referral_admin_actions_affiliate_created_idx",
    ).on(table.affiliateId, table.createdAt),
  }),
);

export type ReferralAdminAction = InferSelectModel<typeof referralAdminAction>;

// =============================================
// Trackable Links (Links Rastreáveis)
// =============================================

export const trackableLink = pgTable("trackable_links", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  // Immutable kebab-case slug carried in the ?lr= URL param. Globally unique
  // and never reused (even after soft-delete) — distributed links and live
  // cookies may still reference it.
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  createdBy: varchar("created_by", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type TrackableLink = InferSelectModel<typeof trackableLink>;

export const trackableLinkClick = pgTable("trackable_link_clicks", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  trackableLinkId: uuid("trackable_link_id")
    .notNull()
    .references(() => trackableLink.id),
  ipHash: varchar("ip_hash", { length: 64 }),
  userAgent: text("user_agent"),
  referrerUrl: text("referrer_url"),
  landingUrl: text("landing_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TrackableLinkClick = InferSelectModel<typeof trackableLinkClick>;

export const customerBaseDailySnapshot = pgTable(
  "customer_base_daily_snapshots",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    snapshotDate: date("snapshot_date").notNull(),
    activePaying: integer("active_paying").notNull(),
    trial: integer("trial").notNull(),
    churnTotal: integer("churn_total").notNull(),
    churnCard: integer("churn_card").notNull(),
    churnPix: integer("churn_pix").notNull(),
    scheduledCancel: integer("scheduled_cancel").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    snapshotDateUnique: uniqueIndex(
      "customer_base_daily_snapshots_snapshot_date_unique",
    ).on(table.snapshotDate),
    snapshotDateIdx: index("customer_base_daily_snapshots_snapshot_date_idx").on(
      table.snapshotDate,
    ),
  }),
);

export type CustomerBaseDailySnapshot = InferSelectModel<
  typeof customerBaseDailySnapshot
>;

// =============================================
// Performance Insights + Masterclass extras
// These tables were created out-of-band in PRODUCTION (the feature code was
// never committed to this repo). Mirrored here 2026-06-09 from the live prod
// DDL so schema.ts describes the real database. Keep byte-equal with
// automatize-frontend/lib/db/schema.ts. When the original feature code is
// recovered, reconcile it with these definitions.
// =============================================

export const performanceSnapshotRun = pgTable(
  "performance_snapshot_runs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    triggeredBy: varchar("triggered_by", { length: 24 })
      .notNull()
      .default("manual"),
    requestedByEmail: varchar("requested_by_email", { length: 100 }),
    userId: uuid("user_id").references(() => user.id),
    status: varchar("status", { length: 24 }).notNull().default("running"),
    window: varchar("window", { length: 24 }).notNull().default("last_7d"),
    rulebookVersion: varchar("rulebook_version", { length: 80 }).notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    errorMessage: text("error_message"),
    summary: jsonb("summary")
      .notNull()
      .default(
        sql`'{"adsEvaluated": 0, "usersEvaluated": 0, "adsetsEvaluated": 0, "insightsCreated": 0, "patternsCreated": 0, "campaignsEvaluated": 0}'::jsonb`
      ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    startedAtIdx: index("performance_snapshot_runs_started_at_idx").on(
      table.startedAt
    ),
    statusIdx: index("performance_snapshot_runs_status_idx").on(table.status),
    userIdIdx: index("performance_snapshot_runs_user_id_idx").on(table.userId),
  })
);

export type PerformanceSnapshotRun = InferSelectModel<
  typeof performanceSnapshotRun
>;

export const performanceSnapshot = pgTable(
  "performance_snapshots",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => performanceSnapshotRun.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id"),
    entityLevel: varchar("entity_level", { length: 16 }).notNull(),
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name"),
    campaignId: text("campaign_id"),
    adsetId: text("adset_id"),
    window: varchar("window", { length: 24 }).notNull(),
    metrics: jsonb("metrics").notNull(),
    payload: jsonb("payload").notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    campaignIdIdx: index("performance_snapshots_campaign_id_idx").on(
      table.campaignId
    ),
    runEntityUnique: uniqueIndex("performance_snapshots_run_entity_unique").on(
      table.runId,
      table.entityLevel,
      table.entityId
    ),
    userIdIdx: index("performance_snapshots_user_id_idx").on(table.userId),
  })
);

export type PerformanceSnapshot = InferSelectModel<typeof performanceSnapshot>;

export const performanceInsight = pgTable(
  "performance_insights",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => performanceSnapshotRun.id),
    snapshotId: uuid("snapshot_id").references(() => performanceSnapshot.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    ruleId: varchar("rule_id", { length: 80 }).notNull(),
    rulebookVersion: varchar("rulebook_version", { length: 80 }).notNull(),
    severity: varchar("severity", { length: 24 }).notNull(),
    confidence: varchar("confidence", { length: 24 }).notNull(),
    entityLevel: varchar("entity_level", { length: 16 }).notNull(),
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name"),
    actionType: varchar("action_type", { length: 48 }).notNull(),
    title: text("title").notNull(),
    evidence: text("evidence").notNull(),
    recommendation: text("recommendation").notNull(),
    metrics: jsonb("metrics").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    reviewedByEmail: varchar("reviewed_by_email", { length: 100 }),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    runIdIdx: index("performance_insights_run_id_idx").on(table.runId),
    statusSeverityIdx: index("performance_insights_status_severity_idx").on(
      table.status,
      table.severity
    ),
    userStatusIdx: index("performance_insights_user_status_idx").on(
      table.userId,
      table.status
    ),
  })
);

export type PerformanceInsight = InferSelectModel<typeof performanceInsight>;

export const performanceCasePattern = pgTable(
  "performance_case_patterns",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => performanceSnapshotRun.id),
    sourceUserId: uuid("source_user_id")
      .notNull()
      .references(() => user.id),
    sourceCampaignId: text("source_campaign_id").notNull(),
    sourceCampaignName: text("source_campaign_name"),
    clientFingerprint: text("client_fingerprint").notNull(),
    description: text("description").notNull(),
    metrics: jsonb("metrics").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    fingerprintIdx: index("performance_case_patterns_fingerprint_idx").on(
      table.clientFingerprint
    ),
    runIdIdx: index("performance_case_patterns_run_id_idx").on(table.runId),
  })
);

export type PerformanceCasePattern = InferSelectModel<
  typeof performanceCasePattern
>;

export const performanceInsightSettings = pgTable(
  "performance_insight_settings",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    enabled: boolean("enabled").notNull().default(false),
    cadence: varchar("cadence", { length: 24 }).notNull().default("weekly"),
    scope: jsonb("scope")
      .notNull()
      .default(
        sql`'{"windows": ["last_7d", "last_14d", "last_30d"], "includeAds": true, "includeAdsets": true, "includeCampaigns": true}'::jsonb`
      ),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    enabledIdx: index("performance_insight_settings_enabled_idx").on(
      table.enabled
    ),
    userUnique: uniqueIndex("performance_insight_settings_user_unique").on(
      table.userId
    ),
  })
);

export type PerformanceInsightSettings = InferSelectModel<
  typeof performanceInsightSettings
>;

export const masterclassComment = pgTable(
  "masterclass_comments",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    // No FK on lesson_id in the live DDL — keep it faithful.
    lessonId: text("lesson_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    lessonCreatedAtIdx: index("masterclass_comments_lesson_created_at_idx").on(
      table.lessonId,
      table.createdAt
    ),
  })
);

export type MasterclassComment = InferSelectModel<typeof masterclassComment>;

export const masterclassMaterial = pgTable(
  "masterclass_materials",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    // No FK on lesson_id in the live DDL — keep it faithful.
    lessonId: text("lesson_id").notNull(),
    title: text("title").notNull(),
    blobUrl: text("blob_url").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    lessonCreatedAtIdx: index(
      "masterclass_materials_lesson_created_at_idx"
    ).on(table.lessonId, table.createdAt),
  })
);

export type MasterclassMaterial = InferSelectModel<typeof masterclassMaterial>;

/**
 * Mat conversation history — an append-only log of Eve channel events.
 * See `../automatize-frontend/docs/adr/0018-mat-conversation-history-as-channel-event-log.md`.
 *
 * Mirrored byte-equivalent in `../automatize-frontend/lib/db/schema.ts` (the
 * frontend writes this history; the backoffice reads it).
 */
export type ConversationChannel = "web" | "whatsapp";

export const conversation = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    /**
     * Deliberately WITHOUT `onDelete: "cascade"`. A conversation is a permanent
     * record that outlives every product flow: nothing may remove a user while
     * their conversations exist. The lone sanctioned eraser is the ops script
     * `automatize-frontend/scripts/delete-user.ts` (ADR 0018).
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    channel: varchar("channel", { length: 16 })
      .$type<ConversationChannel>()
      .notNull(),
    /** Eve runtime session. On WhatsApp, the most recent one (sessions rotate). */
    eveSessionId: text("eve_session_id"),
    /** First user text, truncated. Null until the user speaks. */
    title: text("title"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    lastEventAt: timestamp("last_event_at").notNull().defaultNow(),
  },
  (table) => ({
    userLastEventIdx: index("conversations_user_id_last_event_at_idx").on(
      table.userId,
      table.lastEventAt,
    ),
    /** web: one conversation per Eve session (widget open → close). */
    webSessionUnique: uniqueIndex("conversations_web_session_unique")
      .on(table.eveSessionId)
      .where(sql`"channel" = 'web'`),
    /** whatsapp: one continuous thread per user — no invented boundaries. */
    whatsappUserUnique: uniqueIndex("conversations_whatsapp_user_unique")
      .on(table.userId)
      .where(sql`"channel" = 'whatsapp'`),
  }),
);

export type Conversation = InferSelectModel<typeof conversation>;

export const conversationEvent = pgTable(
  "conversation_events",
  {
    /**
     * Insertion order IS transcript order. A serial (not uuid) because Eve's own
     * `sequence` restarts on every session, so it cannot order a WhatsApp thread
     * that spans sessions.
     */
    id: bigserial("id", { mode: "number" }).primaryKey().notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    turnId: text("turn_id"),
    /** Eve's per-session `sequence`. Metadata only — never an ordering key. */
    seq: integer("seq"),
    /** Eve stream-event type (`message.received`, `action.result`, …). */
    type: varchar("type", { length: 48 }).notNull(),
    payload: jsonb("payload").notNull(),
    /** The payload exceeded the size ceiling and was clipped — never dropped. */
    truncated: boolean("truncated").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    conversationIdIdx: index("conversation_events_conversation_id_id_idx").on(
      table.conversationId,
      table.id,
    ),
  }),
);

export type ConversationEvent = InferSelectModel<typeof conversationEvent>;
