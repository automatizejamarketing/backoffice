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
import {
  COMPANY_CAPABILITIES,
  COMPANY_OFFER_CODES,
  COMPANY_PRODUCT_CODES,
  type CompanyCapability,
  type CompanyOfferCode,
  type CompanyProductCode,
} from "@/lib/company-access/catalog";


export const user = pgTable(
  "users",
  {
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
    vindiCustomerId: varchar("vindi_customer_id", { length: 255 }),
    registryCode: varchar("registry_code", { length: 20 }),
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
  },
  (table) => ({
    uniqueVindiCustomerId: uniqueIndex("users_vindi_customer_id_unique")
      .on(table.vindiCustomerId)
      .where(sql`${table.vindiCustomerId} IS NOT NULL`),
  }),
);

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
    // First click on any template button (quick reply or tracked URL).
    clickedAt: timestamp("clicked_at"),
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

export const whatsappTemplateClickEvent = pgTable(
  "whatsapp_template_click_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    // Null when the click cannot be attributed to a tracked delivery
    // (unknown wamid/token) — kept anyway for inspection.
    deliveryId: uuid("delivery_id").references(
      () => whatsappTemplateDelivery.id,
      { onDelete: "cascade" },
    ),
    kind: varchar("kind", { length: 16 })
      .$type<"url" | "quick_reply">()
      .notNull(),
    // Dedup key for webhook-sourced clicks ("qr:<wamid>"); null for URL
    // clicks, where every hit counts (Postgres unique allows multiple nulls).
    eventKey: varchar("event_key", { length: 512 }),
    clickToken: varchar("click_token", { length: 255 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    buttonText: varchar("button_text", { length: 255 }),
    buttonPayload: varchar("button_payload", { length: 512 }),
    userAgent: text("user_agent"),
    ipHash: varchar("ip_hash", { length: 64 }),
    clickedAt: timestamp("clicked_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    eventKeyUnique: unique(
      "whatsapp_template_click_events_event_key_unique",
    ).on(table.eventKey),
    deliveryCreatedIdx: index(
      "whatsapp_template_click_events_delivery_created_idx",
    ).on(table.deliveryId, table.createdAt),
    providerMessageIdx: index(
      "whatsapp_template_click_events_provider_message_idx",
    ).on(table.providerMessageId),
  }),
);

export type WhatsappTemplateDelivery = InferSelectModel<
  typeof whatsappTemplateDelivery
>;
export type WhatsappTemplateStatusEvent = InferSelectModel<
  typeof whatsappTemplateStatusEvent
>;
export type WhatsappTemplateClickEvent = InferSelectModel<
  typeof whatsappTemplateClickEvent
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

// Digital Products

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

export const PRODUCT_FINANCIAL_MODEL_VALUES = [
  "legacy_net_split",
  "platform_fee_coproduction",
  "platform_fee_coproduction_v2",
  "platform_fee_coproduction_v3",
  "vindi_split_v1",
] as const;
export type ProductFinancialModel =
  (typeof PRODUCT_FINANCIAL_MODEL_VALUES)[number];

export const VINDI_AFFILIATE_STATUS_VALUES = [
  "unverified",
  "pending",
  "verified",
  "rejected",
] as const;
export type VindiAffiliateStatus =
  (typeof VINDI_AFFILIATE_STATUS_VALUES)[number];

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
    platformFeeBasisPoints: integer("platform_fee_basis_points")
      .notNull()
      .default(549),
    platformFeeFixedCentavos: integer("platform_fee_fixed_centavos")
      .notNull()
      .default(39),
    /** Extra fee charged on top of the platform fee when the buyer discovered
     * the product inside the app (checkout_channel = 'marketplace'). Direct
     * sales via the public product URL never pay this component. */
    marketplaceFeeBasisPoints: integer("marketplace_fee_basis_points")
      .notNull()
      .default(300),
    vindiAffiliateId: varchar("vindi_affiliate_id", { length: 255 }),
    vindiAffiliateStatus: varchar("vindi_affiliate_status", {
      enum: [...VINDI_AFFILIATE_STATUS_VALUES],
    })
      .$type<VindiAffiliateStatus>()
      .notNull()
      .default("unverified"),
    status: varchar("status", { enum: ["active", "inactive"] })
      .$type<"active" | "inactive">()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userUnique: unique("expert_profiles_user_id_unique").on(table.userId),
    uniqueVindiAffiliateId: uniqueIndex(
      "expert_profiles_vindi_affiliate_id_unique",
    )
      .on(table.vindiAffiliateId)
      .where(sql`${table.vindiAffiliateId} IS NOT NULL`),
    statusIdx: index("expert_profiles_status_idx").on(table.status),
    platformFeeCheck: check(
      "expert_profiles_platform_fee_range",
      sql`${table.platformFeeBasisPoints} >= 0 AND ${table.platformFeeBasisPoints} <= 10000 AND ${table.platformFeeFixedCentavos} >= 0`,
    ),
    marketplaceFeeCheck: check(
      "expert_profiles_marketplace_fee_range",
      sql`${table.marketplaceFeeBasisPoints} >= 0 AND ${table.marketplaceFeeBasisPoints} <= 10000`,
    ),
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
    /** Frozen per-product expert share for Vindi split (D4). Independent of
     * the v3 `expert_share_basis_points` / coproduction CHECK. */
    expertParticipationBps: integer("expert_participation_bps"),
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
    participationCheck: check(
      "products_expert_participation_range",
      sql`${table.expertParticipationBps} IS NULL OR (${table.expertParticipationBps} >= 0 AND ${table.expertParticipationBps} <= 10000)`,
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

/** Where the buyer discovered the product. `direct` = public product URL
 * (the expert's own traffic, tracked via the `product_direct` cookie);
 * `marketplace` = browsing inside the app. Marketplace purchases pay the
 * expert's marketplace fee on top of the base platform fee. */
export const PRODUCT_CHECKOUT_CHANNEL_VALUES = [
  "direct",
  "marketplace",
] as const;
export type ProductCheckoutChannel =
  (typeof PRODUCT_CHECKOUT_CHANNEL_VALUES)[number];

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
      enum: [...PRODUCT_FINANCIAL_MODEL_VALUES],
    })
      .$type<ProductFinancialModel>()
      .notNull()
      .default("legacy_net_split"),
    platformFeeBasisPoints: integer("platform_fee_basis_points"),
    platformFeeFixedCentavos: integer("platform_fee_fixed_centavos"),
    /** Sales channel frozen at order creation. Historical orders default to
     * 'direct' (no marketplace fee was ever charged before this column). */
    checkoutChannel: varchar("checkout_channel", {
      enum: [...PRODUCT_CHECKOUT_CHANNEL_VALUES],
    })
      .$type<ProductCheckoutChannel>()
      .notNull()
      .default("direct"),
    /** Marketplace component included in platform_fee_basis_points, for
     * auditing/reporting only. Settlement reads the summed total. */
    marketplaceFeeBasisPoints: integer("marketplace_fee_basis_points")
      .notNull()
      .default(0),
    ownerExpertShareBasisPoints: integer("expert_share_basis_points")
      .notNull()
      .default(0),
    coproducerShareBasisPoints: integer("coproducer_share_basis_points")
      .notNull()
      .default(0),
    expertParticipationBps: integer("expert_participation_bps"),
    processingFeeBasisPoints: integer("processing_fee_basis_points"),
    expertAmountCentavos: integer("expert_amount_centavos"),
    platformTheoreticalAmountCentavos: integer(
      "platform_theoretical_amount_centavos",
    ),
    vindiBillId: varchar("vindi_bill_id", { length: 255 }),
    vindiChargeId: varchar("vindi_charge_id", { length: 255 }),
    vindiAffiliateId: varchar("vindi_affiliate_id", { length: 255 }),
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
    checkoutChannelCheck: check(
      "product_orders_checkout_channel_consistency",
      sql`${table.checkoutChannel} IN ('direct', 'marketplace') AND ${table.marketplaceFeeBasisPoints} >= 0 AND ${table.marketplaceFeeBasisPoints} <= 10000 AND (${table.checkoutChannel} = 'marketplace' OR ${table.marketplaceFeeBasisPoints} = 0)`,
    ),
    snapshotCheck: check(
      "product_orders_snapshot_consistency",
      sql`${table.priceCentavos} >= 0 AND ${table.currency} = 'brl' AND ${table.ownerExpertShareBasisPoints} >= 0 AND ${table.ownerExpertShareBasisPoints} <= 10000 AND ${table.coproducerShareBasisPoints} >= 0 AND ${table.coproducerShareBasisPoints} <= 10000 AND ((${table.financialModel} = 'legacy_net_split' AND ${table.platformFeeBasisPoints} IS NULL AND ${table.platformFeeFixedCentavos} IS NULL AND ((${table.expertIdSnapshot} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0) OR ${table.expertIdSnapshot} IS NOT NULL)) OR (${table.financialModel} = 'platform_fee_coproduction' AND ${table.platformFeeBasisPoints} >= 0 AND ${table.platformFeeBasisPoints} <= 10000 AND ${table.platformFeeFixedCentavos} IS NULL AND ((${table.expertIdSnapshot} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0) OR ${table.expertIdSnapshot} IS NOT NULL)) OR (${table.financialModel} = 'platform_fee_coproduction_v2' AND ${table.platformFeeBasisPoints} >= 0 AND ${table.platformFeeBasisPoints} <= 10000 AND ${table.platformFeeFixedCentavos} IS NULL AND ((${table.expertIdSnapshot} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0 AND ${table.coproducerTypeSnapshot} IS NULL AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.expertIdSnapshot} IS NOT NULL AND ${table.ownerExpertShareBasisPoints} + ${table.coproducerShareBasisPoints} = 10000 AND ((${table.coproducerTypeSnapshot} IS NULL AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.coproducerTypeSnapshot} = 'automatize' AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} > 0) OR (${table.coproducerTypeSnapshot} = 'expert' AND ${table.coproducerExpertIdSnapshot} IS NOT NULL AND ${table.coproducerExpertIdSnapshot} <> ${table.expertIdSnapshot} AND ${table.coproducerShareBasisPoints} > 0)))) OR (${table.financialModel} = 'platform_fee_coproduction_v3' AND ${table.platformFeeBasisPoints} >= 0 AND ${table.platformFeeBasisPoints} <= 10000 AND ${table.platformFeeFixedCentavos} >= 0 AND ((${table.expertIdSnapshot} IS NULL AND ${table.platformFeeBasisPoints} = 0 AND ${table.platformFeeFixedCentavos} = 0 AND ${table.ownerExpertShareBasisPoints} = 0 AND ${table.coproducerTypeSnapshot} IS NULL AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.expertIdSnapshot} IS NOT NULL AND ${table.ownerExpertShareBasisPoints} + ${table.coproducerShareBasisPoints} = 10000 AND ((${table.coproducerTypeSnapshot} IS NULL AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} = 0) OR (${table.coproducerTypeSnapshot} = 'automatize' AND ${table.coproducerExpertIdSnapshot} IS NULL AND ${table.coproducerShareBasisPoints} > 0) OR (${table.coproducerTypeSnapshot} = 'expert' AND ${table.coproducerExpertIdSnapshot} IS NOT NULL AND ${table.coproducerExpertIdSnapshot} <> ${table.expertIdSnapshot} AND ${table.coproducerShareBasisPoints} > 0)))) OR (${table.financialModel} = 'vindi_split_v1' AND ${table.expertParticipationBps} >= 0 AND ${table.expertParticipationBps} <= 10000 AND ${table.processingFeeBasisPoints} >= 0 AND ${table.processingFeeBasisPoints} <= 10000 AND (${table.expertAmountCentavos} IS NULL OR ${table.expertAmountCentavos} >= 0) AND (${table.platformTheoreticalAmountCentavos} IS NULL OR ${table.platformTheoreticalAmountCentavos} >= 0) AND ${table.platformFeeBasisPoints} IS NULL AND ${table.platformFeeFixedCentavos} IS NULL AND ${table.ownerExpertShareBasisPoints} = 0 AND ${table.coproducerShareBasisPoints} = 0 AND ${table.coproducerTypeSnapshot} IS NULL AND ${table.coproducerExpertIdSnapshot} IS NULL AND ((${table.expertIdSnapshot} IS NULL AND ${table.expertParticipationBps} = 0) OR ${table.expertIdSnapshot} IS NOT NULL)))`,
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
    financialModel: varchar("financial_model", {
      enum: [...PRODUCT_FINANCIAL_MODEL_VALUES],
    }).$type<ProductFinancialModel>(),
    vindiBillId: varchar("vindi_bill_id", { length: 255 }),
    vindiChargeId: varchar("vindi_charge_id", { length: 255 }),
    vindiAffiliateId: varchar("vindi_affiliate_id", { length: 255 }),
    expertParticipationBps: integer("expert_participation_bps"),
    processingFeeBasisPoints: integer("processing_fee_basis_points"),
    expertAmountCentavos: integer("expert_amount_centavos"),
    platformTheoreticalAmountCentavos: integer(
      "platform_theoretical_amount_centavos",
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
    uniqueVindiChargeId: uniqueIndex("product_payments_vindi_charge_id_unique")
      .on(table.vindiChargeId)
      .where(sql`${table.vindiChargeId} IS NOT NULL`),
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

export type ProactivityAudience = "client" | "consultant";
export type ProactivityDeliveryChannel = "whatsapp" | "slack";
export type ProactivityDeliveryStatus =
  | "scheduled"
  | "sending"
  | "sent"
  | "skipped"
  | "failed";

export const proactivityAlert = pgTable(
  "proactivity_alerts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    ruleKey: varchar("rule_key", { length: 64 }).notNull(),
    audience: varchar("audience", {
      length: 16,
      enum: ["client", "consultant"],
    })
      .$type<ProactivityAudience>()
      .notNull(),
    enabled: boolean("enabled").notNull().default(true),
    thresholds: jsonb("thresholds")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    deliverWhatsapp: boolean("deliver_whatsapp").notNull().default(false),
    deliverSlack: boolean("deliver_slack").notNull().default(false),
    updatedByEmail: varchar("updated_by_email", { length: 100 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    ruleAudienceUnique: uniqueIndex(
      "proactivity_alerts_rule_key_audience_unique",
    ).on(table.ruleKey, table.audience),
    audienceIdx: index("proactivity_alerts_audience_idx").on(table.audience),
  }),
);

export type ProactivityAlert = InferSelectModel<typeof proactivityAlert>;

export const proactivityAlertChangeLog = pgTable(
  "proactivity_alert_change_logs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => proactivityAlert.id),
    adminEmail: varchar("admin_email", { length: 100 }).notNull(),
    fieldName: varchar("field_name", { length: 80 }).notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

export type ProactivityAlertChangeLog = InferSelectModel<
  typeof proactivityAlertChangeLog
>;

export const proactivityAlertDelivery = pgTable(
  "proactivity_alert_deliveries",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => proactivityAlert.id),
    channel: varchar("channel", {
      length: 16,
      enum: ["whatsapp", "slack"],
    })
      .$type<ProactivityDeliveryChannel>()
      .notNull(),
    dedupKey: varchar("dedup_key", { length: 255 }).notNull(),
    status: varchar("status", {
      length: 16,
      enum: ["scheduled", "sending", "sent", "skipped", "failed"],
    })
      .$type<ProactivityDeliveryStatus>()
      .notNull()
      .default("scheduled"),
    reasonCode: varchar("reason_code", { length: 64 }),
    errorMessage: text("error_message"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    alertChannelDedupUnique: uniqueIndex(
      "proactivity_alert_deliveries_alert_channel_dedup_unique",
    ).on(table.alertId, table.channel, table.dedupKey),
    userIdx: index("proactivity_alert_deliveries_user_id_idx").on(table.userId),
  }),
);

export type ProactivityAlertDelivery = InferSelectModel<
  typeof proactivityAlertDelivery
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

export const advertiser = pgTable(
  "advertisers",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    externalAdvertiserId: varchar("external_advertiser_id", { length: 255 })
      .notNull()
      .unique(),
    name: varchar("name", { length: 255 }).notNull(),
    instagramHandle: varchar("instagram_handle", { length: 255 }),
    facebookPageId: varchar("facebook_page_id", { length: 255 }),
    investmentIntensityScore: integer("investment_intensity_score").default(0),
    state: varchar("state", { length: 50 }),
    city: varchar("city", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    instagramHandleIdx: index("advertisers_instagram_handle_idx").on(
      table.instagramHandle,
    ),
    scoreIdx: index("advertisers_investment_intensity_score_idx").on(
      table.investmentIntensityScore,
    ),
  }),
);

export type Advertiser = InferSelectModel<typeof advertiser>;

export const adCreative = pgTable(
  "ad_creatives",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    advertiserId: uuid("advertiser_id")
      .notNull()
      .references(() => advertiser.id),
    externalAdId: varchar("external_ad_id", { length: 255 }).notNull().unique(),
    body: text("body"),
    headline: text("headline"),
    description: text("description"),
    callToAction: varchar("call_to_action", { length: 100 }),
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),
    category: varchar("category", { length: 100 }).notNull(),
    subcategory: varchar("subcategory", { length: 100 }).notNull(),
    categoryConfidence: numeric("category_confidence", { precision: 3, scale: 2 }),
    productRelevanceScore: integer("product_relevance_score"),
    creativeStrengthScore: integer("creative_strength_score"),
    advertiserContinuityScore: integer("advertiser_continuity_score"),
    creativeType: varchar("creative_type", { length: 50 }),
    isActive: boolean("is_active").notNull().default(true),
    isPublished: boolean("is_published").notNull().default(false),
    platforms: jsonb("platforms"),
    startDate: timestamp("start_date"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    advertiserIdx: index("ad_creatives_advertiser_id_idx").on(table.advertiserId),
    categoryIdx: index("ad_creatives_category_idx").on(table.category),
    subcategoryIdx: index("ad_creatives_subcategory_idx").on(table.subcategory),
    isActiveIdx: index("ad_creatives_is_active_idx").on(table.isActive),
    isPublishedIdx: index("ad_creatives_is_published_idx").on(table.isPublished),
  }),
);

export type AdCreative = InferSelectModel<typeof adCreative>;

export const adSnapshot = pgTable(
  "ad_snapshots",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    adCreativeId: uuid("ad_creative_id")
      .notNull()
      .references(() => adCreative.id),
    isActive: boolean("is_active").notNull(),
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
  },
  (table) => ({
    adCreativeIdx: index("ad_snapshots_ad_creative_id_idx").on(table.adCreativeId),
    checkedAtIdx: index("ad_snapshots_checked_at_idx").on(table.checkedAt),
  }),
);

export type AdSnapshot = InferSelectModel<typeof adSnapshot>;

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

// AI Generated Images (Gerar Imagem feature)

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

// AI Text Generation
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

// Generic Generate Post (Gerar Imagem feature)

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

// Food Service Posts
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

// Backoffice Generated Posts

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

// Video Templates (Creatomate)

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

// Stripe Subscription Management

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
  "vindi",
] as const;

export type BillingProvider = (typeof BILLING_PROVIDER_VALUES)[number];

export const VINDI_SUBSCRIPTION_PAYMENT_METHOD_VALUES = [
  "credit_card",
  "pix_automatic",
  "pix_qr",
] as const;
export type VindiSubscriptionPaymentMethod =
  (typeof VINDI_SUBSCRIPTION_PAYMENT_METHOD_VALUES)[number];

export const VINDI_CONSENT_STATUS_VALUES = [
  "pending",
  "awaiting",
  "authorized",
  "rejected",
  "expired",
  "canceled",
] as const;
export type VindiConsentStatus = (typeof VINDI_CONSENT_STATUS_VALUES)[number];

export const PAYMENT_PURPOSE_VALUES = [
  "subscription",
  "product",
  "credit_pack",
  "legacy_renewal",
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSE_VALUES)[number];

export const PAYMENT_SETTLEMENT_METHOD_VALUES = ["credit_card", "pix"] as const;
export type PaymentSettlementMethod =
  (typeof PAYMENT_SETTLEMENT_METHOD_VALUES)[number];

export const VINDI_PAYMENT_LINK_SOURCE_VALUES = [
  "self_service",
  "backoffice",
  "renewal_email",
  "subscription_recovery",
  "checkout",
] as const;
export type VindiPaymentLinkSource =
  (typeof VINDI_PAYMENT_LINK_SOURCE_VALUES)[number];

export const VINDI_PAYMENT_LINK_STATUS_VALUES = [
  "pending",
  "approved",
  "expired",
  "canceled",
  "superseded",
] as const;
export type VindiPaymentLinkStatus =
  (typeof VINDI_PAYMENT_LINK_STATUS_VALUES)[number];

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
    vindiSubscriptionId: varchar("vindi_subscription_id", { length: 255 }),
    vindiPaymentMethod: varchar("vindi_payment_method", {
      enum: [...VINDI_SUBSCRIPTION_PAYMENT_METHOD_VALUES],
    }).$type<VindiSubscriptionPaymentMethod>(),
    vindiConsentStatus: varchar("vindi_consent_status", {
      enum: [...VINDI_CONSENT_STATUS_VALUES],
    }).$type<VindiConsentStatus>(),
    vindiConsentUpdatedAt: timestamp("vindi_consent_updated_at"),
    vindiConsentAuthorizedAt: timestamp("vindi_consent_authorized_at"),
    vindiConsentExpiresAt: timestamp("vindi_consent_expires_at"),
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
    uniqueVindiSubscriptionId: uniqueIndex(
      "subscriptions_vindi_subscription_id_unique",
    )
      .on(table.vindiSubscriptionId)
      .where(sql`${table.vindiSubscriptionId} IS NOT NULL`),
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
    vindiBillId: varchar("vindi_bill_id", { length: 255 }),
    vindiChargeId: varchar("vindi_charge_id", { length: 255 }),
    purpose: varchar("purpose", {
      enum: [...PAYMENT_PURPOSE_VALUES],
    }).$type<PaymentPurpose>(),
    paymentMethod: varchar("payment_method", {
      enum: [...PAYMENT_SETTLEMENT_METHOD_VALUES],
    }).$type<PaymentSettlementMethod>(),
    // The payment's identity AT THE PROVIDER, in a column no provider owns.
    //
    // The per-gateway id columns above stay — plenty of code matches on them,
    // and the Stripe reversal path looks a charge up by three of them. What
    // they cannot do is answer "what is this payment called at its provider?"
    // without the caller already knowing which provider it is. That question is
    // what an idempotency key is built from, so any domain that needs a stable
    // key had to grow a switch over `provider` — and a gateway missing from
    // that switch got silently dropped (ADR 0025's promise, unmet).
    //
    // Written by `createPaymentRecord`, derived from whichever id the gateway
    // supplied. Backfilled for existing rows with EXACTLY the value the old
    // switch returned, so no event key that already exists ever changes value.
    externalId: varchar("external_id", { length: 255 }),
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
    uniqueVindiChargeId: uniqueIndex("payments_vindi_charge_id_unique")
      .on(table.vindiChargeId)
      .where(sql`${table.vindiChargeId} IS NOT NULL`),
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
  | "renewal_email"
  | "subscription_recovery";

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
      enum: [
        "self_service",
        "backoffice",
        "renewal_email",
        "subscription_recovery",
      ],
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

export const vindiPaymentLink = pgTable(
  "vindi_payment_links",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    planType: varchar("plan_type", {
      enum: [...PLAN_TYPE_VALUES],
    }).$type<PlanType>(),
    purpose: varchar("purpose", {
      enum: [...PAYMENT_PURPOSE_VALUES],
    })
      .$type<PaymentPurpose>()
      .notNull(),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 10 }).notNull().default("brl"),
    emvPayload: text("emv_payload"),
    vindiBillId: varchar("vindi_bill_id", { length: 255 }),
    vindiChargeId: varchar("vindi_charge_id", { length: 255 }),
    status: varchar("status", {
      enum: [...VINDI_PAYMENT_LINK_STATUS_VALUES],
    })
      .$type<VindiPaymentLinkStatus>()
      .notNull()
      .default("pending"),
    source: varchar("source", {
      enum: [...VINDI_PAYMENT_LINK_SOURCE_VALUES],
    })
      .$type<VindiPaymentLinkSource>()
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueVindiBillId: uniqueIndex("vindi_payment_links_vindi_bill_id_unique")
      .on(table.vindiBillId)
      .where(sql`${table.vindiBillId} IS NOT NULL`),
    userIdx: index("vindi_payment_links_user_id_idx").on(table.userId),
  }),
);

export type VindiPaymentLink = InferSelectModel<typeof vindiPaymentLink>;

export const vindiWebhookEvent = pgTable(
  "vindi_webhook_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    uniqueIdempotencyKey: uniqueIndex(
      "vindi_webhook_events_idempotency_key_unique",
    )
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    receivedAtIdx: index("vindi_webhook_events_received_at_idx").on(
      table.receivedAt,
    ),
  }),
);

export type VindiWebhookEvent = InferSelectModel<typeof vindiWebhookEvent>;

export type BillingNotificationType =
  | "expiration_3d"
  | "expiration_1d"
  | "payment_confirmed"
  | "dunning"
  | "dunning_reminder";

export const billingNotificationDelivery = pgTable(
  "billing_notification_deliveries",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    subscriptionId: uuid("subscription_id").references(() => subscription.id),
    notificationType: varchar("notification_type", {
      enum: [
        "expiration_3d",
        "expiration_1d",
        "payment_confirmed",
        "dunning",
        "dunning_reminder",
      ],
    })
      .$type<BillingNotificationType>()
      .notNull(),
    expirationDate: timestamp("expiration_date").notNull(),
    mercadopagoPaymentLinkId: uuid("mercadopago_payment_link_id").references(
      () => mercadopagoPaymentLink.id,
    ),
    vindiChargeId: varchar("vindi_charge_id", { length: 255 }),
    channel: varchar("channel", { length: 20 })
      .$type<"email" | "whatsapp">()
      .notNull()
      .default("email"),
    deliveryStatus: varchar("delivery_status", { length: 20 })
      .$type<"scheduled" | "sent" | "failed">()
      .notNull()
      .default("scheduled"),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueDelivery: uniqueIndex(
      "billing_notification_deliveries_user_type_expiration_unique",
    )
      .on(
        table.userId,
        table.notificationType,
        table.expirationDate,
        table.channel,
      )
      .where(sql`${table.vindiChargeId} IS NULL`),
    uniqueLinkDelivery: unique(
      "billing_notification_deliveries_link_type_channel_unique",
    ).on(table.mercadopagoPaymentLinkId, table.notificationType, table.channel),
    uniqueVindiChargeDelivery: uniqueIndex(
      "billing_notification_deliveries_vindi_charge_type_channel_unique",
    )
      .on(table.vindiChargeId, table.notificationType, table.channel)
      .where(sql`${table.vindiChargeId} IS NOT NULL`),
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

// Affiliate System

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
  "tax_document_updated",
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
 * Histórico de bloqueios do afiliado — um período por linha, nunca apagado.
 *
 * Existe porque `referral_affiliates.status` responde "está bloqueado AGORA?" e
 * o motor de comissão precisa de outra pergunta: "estava bloqueado NAQUELA
 * data?". Enquanto só havia o status e um `blocked_at`, reativar apagava a
 * única evidência de que houve período bloqueado — e uma fatura daquele
 * período, ainda não processada, passava a comissionar no instante da
 * reativação.
 *
 * Mesmo idioma de `referral_agreements`: o encerrado é marcado, não removido,
 * porque é ele que explica o passado. E o mesmo idioma do saque: um índice
 * único parcial garante no máximo um período aberto por afiliado.
 */
export const referralAffiliateBlock = pgTable(
  "referral_affiliate_blocks",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    affiliateId: uuid("affiliate_id")
      .notNull()
      .references(() => referralAffiliate.id),
    blockedAt: timestamp("blocked_at").notNull().defaultNow(),
    blockedBy: varchar("blocked_by", { length: 120 }),
    blockReason: text("block_reason"),
    /** `null` enquanto o bloqueio estiver vigente. */
    unblockedAt: timestamp("unblocked_at"),
    unblockedBy: varchar("unblocked_by", { length: 120 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    affiliateIdx: index("referral_affiliate_blocks_affiliate_idx").on(
      table.affiliateId,
      table.blockedAt,
    ),
  }),
);

export type ReferralAffiliateBlock = InferSelectModel<
  typeof referralAffiliateBlock
>;


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

// Trackable Links (Links Rastreáveis)

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

// Performance Insights + Masterclass extras
// These tables were created out-of-band in PRODUCTION (the feature code was
// never committed to this repo). Mirrored here 2026-06-09 from the live prod
// DDL so schema.ts describes the real database. Keep byte-equal with
// automatize-frontend/lib/db/schema.ts. When the original feature code is
// recovered, reconcile it with these definitions.

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

// ===== BEGIN meta_tracking_* — bloco espelhado byte a byte no projeto irmão =====
//
// Fundação de tracking de campanhas Meta (§4 do plano
// `backoffice/docs/plans/campaign-tracking-foundation.md`). Sete tabelas
// registram, para toda conta de anúncio conectada, três coisas em três formatos
// diferentes porque elas mudam em ritmos diferentes: a CONFIGURAÇÃO de cada
// entidade ao longo do tempo (versões), os RESULTADOS dia a dia (série) e as
// AÇÕES tomadas (stream), com autor e motivo quando a ação nasceu dentro da
// plataforma.
//
// A Meta não guarda histórico de configuração — só o estado atual — e sua
// janela de insights desliza (37 meses). O que não for capturado no dia é
// perdido para sempre; daí a obsessão com idempotência e cobertura.
//
// O backoffice é o dono da migration e do coletor. Este bloco vive nos dois
// `schema.ts` porque o Postgres é um só, e
// `automatize-frontend/tests/meta-tracking-schema-parity.test.ts` compara os
// dois blocos byte a byte: editar um lado sem o outro quebra o teste, que é
// exatamente o ponto.
//
// Nada aqui altera tabela existente. As tabelas legadas de edit log
// (`campaign_edit_logs`, `adset_edit_logs`, `ad_creative_edit_logs`) seguem
// intactas e recebem dual-write, com ponte em
// `meta_tracking_change_events.legacy_edit_log_*`.

/** A hierarquia inteira é trackeada igual — campanha, conjunto e anúncio. */
export type MetaTrackingEntityLevel = "campaign" | "adset" | "ad";

/**
 * `CBO` = orçamento na campanha; `ABO` = no conjunto. Derivado na coleta: a
 * Meta não devolve o modo, devolve em qual nível o orçamento está.
 */
export type MetaTrackingBudgetMode = "CBO" | "ABO";

/**
 * Diff campo a campo pré-computado NA COLETA — é o que dispensa comparar
 * configurações em tempo de consulta e o que a busca por campo alterado
 * (`changed_fields ? 'daily_budget'`) interroga.
 */
export type MetaTrackingChangedFields = Record<
  string,
  { old: unknown; new: unknown }
>;

/**
 * `created` e `config_change` andam com versões de configuração;
 * `status_transition`, `archived` e `deleted_detected` são ciclo de vida e
 * NÃO geram versão — estado efetivo é campo volátil (ver a tabela de versões).
 */
export type MetaTrackingChangeKind =
  | "created"
  | "config_change"
  | "status_transition"
  | "archived"
  | "deleted_detected";

/**
 * De onde veio a ação. `backoffice_admin` é a única origem com motivo
 * obrigatório (regra de aplicação, não do banco: o mesmo evento vindo do
 * coletor legitimamente não tem motivo). `external_detected` é o que o diff
 * descobriu de mudanças feitas direto no Gerenciador de Anúncios.
 */
export type MetaTrackingChangeSource =
  | "backoffice_admin"
  | "frontend_user"
  | "external_detected"
  | "system";

export type MetaTrackingRunKind = "daily" | "backfill";

export type MetaTrackingRunTriggeredBy = "cron" | "script" | "manual";

export type MetaTrackingRunStatus =
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

/**
 * `skipped_reconnect` / `skipped_no_token` são buraco irrecuperável: sem token
 * não há coleta, e a configuração daquele dia não existe em lugar nenhum para
 * ser buscada depois. Por isso a cobertura é a fonte da tela de operação, e não
 * só um log.
 */
export type MetaTrackingCoverageStatus =
  | "complete"
  | "partial"
  | "failed"
  | "skipped_reconnect"
  | "skipped_no_token";

/**
 * Execução de coleta. O cron dispara várias vezes na mesma madrugada drenando
 * lotes (limite de duração da plataforma), então "run" é uma invocação, não um
 * dia: quem responde "o dia está coberto?" é `meta_tracking_account_coverage`.
 */
export const metaTrackingRun = pgTable(
  "meta_tracking_runs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    kind: varchar("kind", { length: 16 })
      .$type<MetaTrackingRunKind>()
      .notNull()
      .default("daily"),
    triggeredBy: varchar("triggered_by", { length: 16 })
      .$type<MetaTrackingRunTriggeredBy>()
      .notNull()
      .default("cron"),
    status: varchar("status", { length: 24 })
      .$type<MetaTrackingRunStatus>()
      .notNull()
      .default("running"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    errorMessage: text("error_message"),
    summary: jsonb("summary")
      .notNull()
      .default(
        sql`'{"eventsCreated": 0, "entitiesSeen": 0, "accountsCovered": 0, "accountsSkipped": 0, "versionsCreated": 0, "metricRowsUpserted": 0}'::jsonb`,
      ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    startedAtIdx: index("meta_tracking_runs_started_at_idx").on(
      table.startedAt,
    ),
    statusIdx: index("meta_tracking_runs_status_idx").on(table.status),
    kindStartedAtIdx: index("meta_tracking_runs_kind_started_at_idx").on(
      table.kind,
      table.startedAt,
    ),
  }),
);

export type MetaTrackingRun = InferSelectModel<typeof metaTrackingRun>;

/**
 * Cobertura por conta × dia. É o mecanismo de claim (conta sem cobertura
 * `complete` no dia = pendente, e o próximo disparo do cron a pega) e a fonte
 * da tela de operação. Moeda e timezone vivem aqui, não por linha de métrica:
 * são propriedade da conta de anúncio, e é a timezone dela que define o que a
 * Meta chama de "dia".
 */
export const metaTrackingAccountCoverage = pgTable(
  "meta_tracking_account_coverage",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => metaTrackingRun.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id").notNull(),
    businessDate: date("business_date").notNull(),
    status: varchar("status", { length: 24 })
      .$type<MetaTrackingCoverageStatus>()
      .notNull(),
    errorMessage: text("error_message"),
    entitiesSeen: integer("entities_seen").notNull().default(0),
    apiCallsUsed: integer("api_calls_used").notNull().default(0),
    currency: varchar("currency", { length: 8 }),
    timezoneName: varchar("timezone_name", { length: 64 }),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    accountDateUnique: uniqueIndex(
      "meta_tracking_account_coverage_account_date_unique",
    ).on(table.accountId, table.businessDate),
    dateStatusIdx: index("meta_tracking_account_coverage_date_status_idx").on(
      table.businessDate,
      table.status,
    ),
    runIdx: index("meta_tracking_account_coverage_run_idx").on(table.runId),
    userDateIdx: index("meta_tracking_account_coverage_user_date_idx").on(
      table.userId,
      table.businessDate,
    ),
  }),
);

export type MetaTrackingAccountCoverage = InferSelectModel<
  typeof metaTrackingAccountCoverage
>;

/**
 * Eventos crus do audit trail da Meta (`/act_{id}/activities`) — persistidos
 * inteiros, inclusive os que não casam com ação nenhuma (billing, públicos,
 * papéis da conta), porque são matéria-prima de propósitos futuros.
 *
 * Enriquecimento oportunista, nunca fonte primária: o formato de `extra_data`
 * e a retenção do endpoint não são documentados. O diff do coletor é que manda.
 *
 * `dedup_hash` é sha256 de `(account_id, event_type, event_time, object_id,
 * actor_id)` — o evento não tem id próprio documentado. É hash, e não unique
 * composto, porque `object_id` e `actor_id` vêm nulos em parte dos eventos e no
 * Postgres NULL nunca colide com NULL: o unique composto deixaria passar
 * duplicata justo na sobreposição de 48 h que o poll faz de propósito.
 */
export const metaTrackingActivityEvent = pgTable(
  "meta_tracking_activity_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id").notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    translatedEventType: text("translated_event_type"),
    eventTime: timestamp("event_time").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    applicationId: text("application_id"),
    objectId: text("object_id"),
    objectType: varchar("object_type", { length: 48 }),
    objectName: text("object_name"),
    /** Opaco de propósito: não documentado, pode sumir sem aviso. */
    extraData: jsonb("extra_data"),
    dedupHash: varchar("dedup_hash", { length: 64 }).notNull(),
    /**
     * Sem FK para `meta_tracking_change_events` de propósito: a ponte canônica
     * é o `activity_event_id` do lado do evento de mudança, e um par de FKs
     * mútuas obrigaria a ordenar inserts que o matcher faz em qualquer ordem.
     */
    matchedChangeEventId: uuid("matched_change_event_id"),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (table) => ({
    dedupHashUnique: uniqueIndex(
      "meta_tracking_activity_events_dedup_hash_unique",
    ).on(table.dedupHash),
    accountTimeIdx: index("meta_tracking_activity_events_account_time_idx").on(
      table.accountId,
      table.eventTime,
    ),
    objectIdx: index("meta_tracking_activity_events_object_idx").on(
      table.objectId,
    ),
  }),
);

export type MetaTrackingActivityEvent = InferSelectModel<
  typeof metaTrackingActivityEvent
>;

/**
 * Versões de configuração (SCD tipo 2): uma linha por entidade × configuração
 * distinta, aberta na primeira observação e fechada (`valid_to`) quando a
 * configuração muda. "Estado da entidade em qualquer data" vira uma consulta de
 * vigência; versão nova só nasce quando algo mudou de fato, o que mantém o
 * histórico denso em informação.
 *
 * CAMPOS VOLÁTEIS — GRAVADOS AQUI, MAS FORA DO HASH: `effective_status`,
 * `budget_remaining`, `learning_stage_info`, `issues_info`, `updated_time_meta`
 * e `last_budget_toggling_time` NÃO entram em `config_hash` e portanto não
 * abrem versão nova. Eles mudam sozinhos — o estado efetivo cai por cascata
 * quando o pai pausa, o restante do orçamento muda a cada gasto, a fase de
 * aprendizado anda sem ninguém tocar em nada. Se entrassem no hash, toda
 * entidade ganharia versão nova todo dia e a pergunta "o que estava valendo
 * quando o resultado mudou?" perderia a resposta no ruído. Transição de estado
 * vira `meta_tracking_change_events`, não versão.
 */
export const metaTrackingConfigVersion = pgTable(
  "meta_tracking_config_versions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id").notNull(),
    entityLevel: varchar("entity_level", { length: 16 })
      .$type<MetaTrackingEntityLevel>()
      .notNull(),
    entityId: text("entity_id").notNull(),
    /** Desnormalizados para filtrar sem join; nulos no próprio nível. */
    campaignId: text("campaign_id"),
    adsetId: text("adset_id"),
    entityName: text("entity_name"),

    validFrom: timestamp("valid_from").notNull().defaultNow(),
    /** NULL = versão vigente. */
    validTo: timestamp("valid_to"),
    versionNumber: integer("version_number").notNull().default(1),
    firstSeenRunId: uuid("first_seen_run_id").references(
      () => metaTrackingRun.id,
    ),
    /** Última vez que a coleta viu esta configuração idêntica. */
    lastConfirmedAt: timestamp("last_confirmed_at").notNull().defaultNow(),

    /** sha256 da configuração normalizada — chaves ordenadas, voláteis fora. */
    configHash: varchar("config_hash", { length: 64 }).notNull(),
    /**
     * Resposta integral da Graph API. Existe para o campo que hoje ninguém
     * consulta já estar capturado quando um propósito futuro precisar dele.
     */
    config: jsonb("config").notNull(),
    /**
     * Prefixo de Campanha Gerenciada avaliado na coleta, POR VERSÃO: renomear
     * uma campanha muda a marca daqui para frente sem reescrever a história.
     */
    isManaged: boolean("is_managed").notNull().default(false),

    // Colunas tipadas (consulta quente). NULL quando não se aplicam ao nível.
    configuredStatus: varchar("configured_status", { length: 24 }),
    createdTimeMeta: timestamp("created_time_meta"),

    // Campanha
    objective: varchar("objective", { length: 48 }),
    buyingType: varchar("buying_type", { length: 24 }),
    bidStrategy: varchar("bid_strategy", { length: 48 }),
    spendCap: numeric("spend_cap"),
    specialAdCategories: jsonb("special_ad_categories"),
    /** Advantage+: distingue ASC/AAC legadas da estrutura nova. */
    smartPromotionType: varchar("smart_promotion_type", { length: 48 }),
    advantageState: varchar("advantage_state", { length: 48 }),
    isAdsetBudgetSharingEnabled: boolean("is_adset_budget_sharing_enabled"),
    budgetMode: varchar("budget_mode", {
      length: 8,
    }).$type<MetaTrackingBudgetMode>(),

    /** Campanha ou conjunto — a Meta põe o orçamento em um nível ou no outro. */
    dailyBudget: numeric("daily_budget"),
    lifetimeBudget: numeric("lifetime_budget"),

    // Conjunto
    optimizationGoal: varchar("optimization_goal", { length: 48 }),
    billingEvent: varchar("billing_event", { length: 48 }),
    bidAmount: numeric("bid_amount"),
    destinationType: varchar("destination_type", { length: 48 }),
    startTime: timestamp("start_time"),
    endTime: timestamp("end_time"),
    isDynamicCreative: boolean("is_dynamic_creative"),
    targeting: jsonb("targeting"),
    promotedObject: jsonb("promoted_object"),
    attributionSpec: jsonb("attribution_spec"),
    frequencyControlSpecs: jsonb("frequency_control_specs"),
    pacingType: jsonb("pacing_type"),
    dsaBeneficiary: text("dsa_beneficiary"),
    dsaPayor: text("dsa_payor"),

    // Anúncio
    creativeId: text("creative_id"),
    conversionDomain: text("conversion_domain"),
    trackingSpecs: jsonb("tracking_specs"),

    // Voláteis — fora do hash. Ver o comentário da tabela.
    effectiveStatus: varchar("effective_status", { length: 32 }),
    budgetRemaining: numeric("budget_remaining"),
    learningStageInfo: jsonb("learning_stage_info"),
    issuesInfo: jsonb("issues_info"),
    updatedTimeMeta: timestamp("updated_time_meta"),
    lastBudgetTogglingTime: timestamp("last_budget_toggling_time"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    /** Reexecutar a coleta no mesmo dia reencontra a linha em vez de duplicar. */
    entityHashValidFromUnique: uniqueIndex(
      "meta_tracking_config_versions_entity_hash_valid_from_unique",
    ).on(table.entityLevel, table.entityId, table.configHash, table.validFrom),
    /** Versão vigente: o caminho de leitura de "estado em qualquer data". */
    currentIdx: index("meta_tracking_config_versions_current_idx")
      .on(table.entityLevel, table.entityId)
      .where(sql`"valid_to" is null`),
    accountValidFromIdx: index(
      "meta_tracking_config_versions_account_valid_from_idx",
    ).on(table.accountId, table.validFrom),
    userIdx: index("meta_tracking_config_versions_user_idx").on(table.userId),
  }),
);

export type MetaTrackingConfigVersion = InferSelectModel<
  typeof metaTrackingConfigVersion
>;

/**
 * Stream unificado de ações: toda mudança, em qualquer nível e de qualquer
 * origem, é uma linha aqui. É a tabela que responde "o que foi feito, quando,
 * por quem e por quê" — e a que os propósitos futuros consomem.
 *
 * O motivo (`note`) é obrigatório na aplicação quando `source =
 * "backoffice_admin"`, e não no banco: o mesmo evento vindo do coletor
 * (`external_detected`) legitimamente não tem motivo, porque ninguém o
 * declarou. A obrigação vive onde existe alguém para responder por ela.
 */
export const metaTrackingChangeEvent = pgTable(
  "meta_tracking_change_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id").notNull(),
    entityLevel: varchar("entity_level", { length: 16 })
      .$type<MetaTrackingEntityLevel>()
      .notNull(),
    entityId: text("entity_id").notNull(),
    campaignId: text("campaign_id"),
    adsetId: text("adset_id"),
    entityName: text("entity_name"),

    changeKind: varchar("change_kind", { length: 24 })
      .$type<MetaTrackingChangeKind>()
      .notNull(),
    changedFields: jsonb("changed_fields")
      .$type<MetaTrackingChangedFields>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Nulos nas transições de estado puras, que não abrem versão. */
    fromConfigVersionId: uuid("from_config_version_id").references(
      () => metaTrackingConfigVersion.id,
    ),
    toConfigVersionId: uuid("to_config_version_id").references(
      () => metaTrackingConfigVersion.id,
    ),

    source: varchar("source", { length: 24 })
      .$type<MetaTrackingChangeSource>()
      .notNull(),
    actorEmail: varchar("actor_email", { length: 100 }),
    /** Nome que o audit trail da Meta atribuiu, quando houve match. */
    actorNameMeta: text("actor_name_meta"),
    note: text("note"),

    /** Exato quando conhecido (escrita interna ou activities); senão = detecção. */
    occurredAt: timestamp("occurred_at").notNull(),
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
    detectionRunId: uuid("detection_run_id").references(
      () => metaTrackingRun.id,
    ),
    activityEventId: uuid("activity_event_id").references(
      () => metaTrackingActivityEvent.id,
    ),

    /** Ponte com o edit log legado gravado no mesmo dual-write. */
    legacyEditLogTable: varchar("legacy_edit_log_table", { length: 32 }),
    legacyEditLogId: uuid("legacy_edit_log_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    entityOccurredIdx: index(
      "meta_tracking_change_events_entity_occurred_idx",
    ).on(table.entityLevel, table.entityId, table.occurredAt),
    accountOccurredIdx: index(
      "meta_tracking_change_events_account_occurred_idx",
    ).on(table.accountId, table.occurredAt),
    userOccurredIdx: index("meta_tracking_change_events_user_occurred_idx").on(
      table.userId,
      table.occurredAt,
    ),
    sourceIdx: index("meta_tracking_change_events_source_idx").on(table.source),
  }),
);

export type MetaTrackingChangeEvent = InferSelectModel<
  typeof metaTrackingChangeEvent
>;

/**
 * Série diária de resultados: uma linha por entidade × dia, sempre com
 * granularidade de um dia. Janela de análise é consulta, nunca armazenamento.
 *
 * Os insights da Meta mudam retroativamente por até 28 dias (atribuição) e só
 * então congelam, então a coleta reescreve a janela móvel todo dia por upsert e
 * marca `is_final` quando o dia sai dela. Nunca deletar: o que já foi capturado
 * é a única cópia que existe depois que a janela de 37 meses passar.
 *
 * O dia é o da timezone da conta de anúncio, e o valor está na moeda dela —
 * ambos registrados em `meta_tracking_account_coverage`, não por linha.
 *
 * ## Contrato de leitura: análise lê COLUNAS, o jsonb é RESERVATÓRIO
 *
 * As métricas conhecidas estão promovidas a colunas nullable. Quem analisa lê
 * coluna tipada — nunca abre `actions`/`action_values` em consulta. As famílias
 * cruas continuam gravadas inteiras porque são o reservatório de promoção: elas
 * permitem criar amanhã a coluna de uma métrica que hoje ninguém consulta, já
 * preenchida sobre o histórico de ontem (é o que o script
 * `scripts/backfill-metric-columns.ts` faz).
 *
 * Daí as três regras que valem para sempre nesta tabela:
 *
 * 1. **Campo novo interessante da Meta entra no field set IMEDIATAMENTE**, mesmo
 *    sem coluna. Capturar é irreversível no tempo (a janela de 37 meses desliza
 *    todo dia); promover não é.
 * 2. **`NULL` é "não reportado", não zero.** Dia de campanha de mensagens não
 *    tem compra; gravar `0` apagaria a diferença entre "não se aplica" e
 *    "tentou e não vendeu". O zero-verdadeiro se resolve na leitura, com
 *    objetivo + `spend` em mãos.
 * 3. **Conversões personalizadas são a exceção conhecida.** O nome delas é
 *    dinâmico por conta (`offsite_conversion.custom.<id>`), então não há coluna
 *    possível: seguem legíveis só pelo jsonb cru.
 *
 * A extração vive num ponto só — `lib/meta-tracking/metric-columns.ts` — e é
 * lá que moram as listas de prioridade que impedem a dupla contagem
 * (`omni_purchase` e `purchase` são o mesmo fato).
 */
export const metaTrackingDailyMetric = pgTable(
  "meta_tracking_daily_metrics",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    accountId: text("account_id").notNull(),
    entityLevel: varchar("entity_level", { length: 16 })
      .$type<MetaTrackingEntityLevel>()
      .notNull(),
    entityId: text("entity_id").notNull(),
    campaignId: text("campaign_id"),
    adsetId: text("adset_id"),
    metricDate: date("metric_date").notNull(),

    spend: numeric("spend"),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    reach: integer("reach"),
    frequency: numeric("frequency"),

    /** Famílias de cardinalidade variável — tipar seria inventar colunas. */
    actions: jsonb("actions"),
    actionValues: jsonb("action_values"),
    costPerActionType: jsonb("cost_per_action_type"),
    costPerResult: jsonb("cost_per_result"),
    purchaseRoas: jsonb("purchase_roas"),
    websitePurchaseRoas: jsonb("website_purchase_roas"),
    /**
     * As sete famílias de vídeo do field set num reservatório só, chaveadas pelo
     * nome do campo da Meta. Todas têm a mesma forma
     * (`[{ action_type: "video_view", value }]`), então sete colunas jsonb não
     * comprariam nada — mas ficar só nas colunas escalares deixaria o vídeo
     * fora do reservatório, e é dele que sai qualquer promoção futura.
     */
    videoActions: jsonb("video_actions"),

    /*
     * Métricas promovidas a coluna — o modelo de leitura tipado. Todas
     * nullable: `NULL` é "a Meta não reportou". Contagens `integer`, dinheiro e
     * razões `numeric`. `purchase_roas_value`/`cost_per_result_value` levam o
     * sufixo porque `purchase_roas`/`cost_per_result` já são o jsonb cru da
     * mesma métrica: o sufixo é o que diz "o escalar promovido daquela família".
     */
    linkClicks: integer("link_clicks"),
    landingPageViews: integer("landing_page_views"),
    contentViews: integer("content_views"),
    addsToCart: integer("adds_to_cart"),
    checkoutsInitiated: integer("checkouts_initiated"),
    paymentInfosAdded: integer("payment_infos_added"),
    purchases: integer("purchases"),
    /** Unidades MAIORES da moeda da conta, como `spend`. */
    purchaseValue: numeric("purchase_value"),
    purchaseRoasValue: numeric("purchase_roas_value"),

    leads: integer("leads"),
    registrationsCompleted: integer("registrations_completed"),

    messagingConversationsStarted: integer("messaging_conversations_started"),
    messagingFirstReplies: integer("messaging_first_replies"),

    postEngagements: integer("post_engagements"),
    pageEngagements: integer("page_engagements"),
    postReactions: integer("post_reactions"),
    comments: integer("comments"),
    shares: integer("shares"),
    postSaves: integer("post_saves"),
    pageLikes: integer("page_likes"),

    videoViews3s: integer("video_views_3s"),
    thruplays: integer("thruplays"),
    videoWatchesP25: integer("video_watches_p25"),
    videoWatchesP50: integer("video_watches_p50"),
    videoWatchesP75: integer("video_watches_p75"),
    videoWatchesP95: integer("video_watches_p95"),
    videoWatchesP100: integer("video_watches_p100"),
    videoAvgWatchSeconds: numeric("video_avg_watch_seconds"),

    estimatedAdRecallers: integer("estimated_ad_recallers"),
    appInstalls: integer("app_installs"),
    /** Resultado na definição da própria conta (o `indicator` do custo). */
    results: integer("results"),
    costPerResultValue: numeric("cost_per_result_value"),

    firstCapturedAt: timestamp("first_captured_at").notNull().defaultNow(),
    lastRefreshedAt: timestamp("last_refreshed_at").notNull().defaultNow(),
    /** O dia saiu da janela de 28 dias: o número não muda mais. */
    isFinal: boolean("is_final").notNull().default(false),
  },
  (table) => ({
    entityDateUnique: uniqueIndex(
      "meta_tracking_daily_metrics_entity_date_unique",
    ).on(table.entityLevel, table.entityId, table.metricDate),
    accountDateIdx: index("meta_tracking_daily_metrics_account_date_idx").on(
      table.accountId,
      table.metricDate,
    ),
    campaignDateIdx: index("meta_tracking_daily_metrics_campaign_date_idx").on(
      table.campaignId,
      table.metricDate,
    ),
    userDateIdx: index("meta_tracking_daily_metrics_user_date_idx").on(
      table.userId,
      table.metricDate,
    ),
  }),
);

export type MetaTrackingDailyMetric = InferSelectModel<
  typeof metaTrackingDailyMetric
>;

/**
 * Snapshot de criativo, chaveado pelo id da própria Meta: criativos são
 * imutáveis na prática (não têm `updated_time` documentado), então uma linha
 * por criativo basta. Buscado quando um anúncio referencia um criativo
 * desconhecido — é o que permite correlacionar troca de criativo com o conteúdo
 * do criativo, em vez de só com o id dele.
 */
export const metaTrackingCreative = pgTable(
  "meta_tracking_creatives",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    spec: jsonb("spec").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (table) => ({
    accountIdx: index("meta_tracking_creatives_account_idx").on(
      table.accountId,
    ),
  }),
);

export type MetaTrackingCreative = InferSelectModel<typeof metaTrackingCreative>;

// ===== END meta_tracking_* =====
function sqlStringList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql.raw(`'${value.replaceAll("'", "''")}'`)),
    sql.raw(", "),
  );
}

const COMPANY_ENTITLEMENT_STATUSES = ["active", "expired", "revoked"] as const;
const COMPANY_ENTITLEMENT_SOURCES = [
  "legacy_subscription",
  "stripe",
  "manual",
] as const;
const COMPANY_ENTITLEMENT_EVENT_TYPES = [
  "activated",
  "renewed",
  "expired",
  "revoked",
  "corrected",
] as const;
const COMPANY_MODULE_SUBSCRIPTION_STATUSES = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
] as const;
const COMPANY_INVITATION_STATUSES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;
const COMPANY_INVITATION_ROLES = ["admin", "member"] as const;

export type CompanyEntitlementStatus =
  (typeof COMPANY_ENTITLEMENT_STATUSES)[number];
export type CompanyEntitlementSource =
  (typeof COMPANY_ENTITLEMENT_SOURCES)[number];
export type CompanyModuleSubscriptionStatus =
  (typeof COMPANY_MODULE_SUBSCRIPTION_STATUSES)[number];
export type CompanyInvitationStatus =
  (typeof COMPANY_INVITATION_STATUSES)[number];

export const companyProductEntitlement = pgTable(
  "company_product_entitlements",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    productCode: varchar("product_code", { enum: [...COMPANY_PRODUCT_CODES] })
      .$type<CompanyProductCode>()
      .notNull(),
    status: varchar("status", { enum: [...COMPANY_ENTITLEMENT_STATUSES] })
      .$type<CompanyEntitlementStatus>()
      .notNull(),
    source: varchar("source", { enum: [...COMPANY_ENTITLEMENT_SOURCES] })
      .$type<CompanyEntitlementSource>()
      .notNull(),
    validFrom: timestamp("valid_from").notNull().defaultNow(),
    validUntil: timestamp("valid_until"),
    sourceReference: varchar("source_reference", { length: 255 }),
    grantedByUserId: uuid("granted_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.companyId, table.productCode] }),
    companyStatusIdx: index(
      "company_product_entitlements_company_status_idx",
    ).on(table.companyId, table.status),
    statusCheck: check(
      "company_product_entitlements_status_check",
      sql`${table.status} IN (${sqlStringList(COMPANY_ENTITLEMENT_STATUSES)})`,
    ),
    sourceCheck: check(
      "company_product_entitlements_source_check",
      sql`${table.source} IN (${sqlStringList(COMPANY_ENTITLEMENT_SOURCES)})`,
    ),
    productCodeCheck: check(
      "company_product_entitlements_product_code_check",
      sql`${table.productCode} IN (${sqlStringList(COMPANY_PRODUCT_CODES)})`,
    ),
    validUntilCheck: check(
      "company_product_entitlements_valid_until_check",
      sql`${table.source} = 'manual' OR ${table.validUntil} IS NOT NULL`,
    ),
    validPeriodCheck: check(
      "company_product_entitlements_valid_period_check",
      sql`(${table.status} = 'active' AND (${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom})) OR (${table.status} IN ('expired', 'revoked') AND ${table.validUntil} IS NOT NULL AND ${table.validUntil} >= ${table.validFrom})`,
    ),
    lifecycleCheck: check(
      "company_product_entitlements_lifecycle_check",
      sql`${table.status} = 'active' OR ${table.validUntil} IS NOT NULL`,
    ),
  }),
);

export type CompanyProductEntitlement = InferSelectModel<
  typeof companyProductEntitlement
>;

export const companyProductEntitlementEvent = pgTable(
  "company_product_entitlement_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    productCode: varchar("product_code", { enum: [...COMPANY_PRODUCT_CODES] })
      .$type<CompanyProductCode>()
      .notNull(),
    eventType: varchar("event_type", {
      enum: [...COMPANY_ENTITLEMENT_EVENT_TYPES],
    }).notNull(),
    status: varchar("status", { enum: [...COMPANY_ENTITLEMENT_STATUSES] })
      .$type<CompanyEntitlementStatus>()
      .notNull(),
    source: varchar("source", { enum: [...COMPANY_ENTITLEMENT_SOURCES] })
      .$type<CompanyEntitlementSource>()
      .notNull(),
    validFrom: timestamp("valid_from").notNull(),
    validUntil: timestamp("valid_until"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    entitlementFk: foreignKey({
      columns: [table.companyId, table.productCode],
      foreignColumns: [
        companyProductEntitlement.companyId,
        companyProductEntitlement.productCode,
      ],
      name: "company_product_entitlement_events_entitlement_fk",
    }),
    idempotencyUnique: uniqueIndex(
      "company_product_entitlement_events_idempotency_unique",
    ).on(table.idempotencyKey),
    entitlementOccurredIdx: index(
      "company_product_entitlement_events_entitlement_occurred_idx",
    ).on(table.companyId, table.productCode, table.occurredAt),
    eventTypeCheck: check(
      "company_product_entitlement_events_event_type_check",
      sql`${table.eventType} IN (${sqlStringList(COMPANY_ENTITLEMENT_EVENT_TYPES)})`,
    ),
    statusCheck: check(
      "company_product_entitlement_events_status_check",
      sql`${table.status} IN (${sqlStringList(COMPANY_ENTITLEMENT_STATUSES)})`,
    ),
    sourceCheck: check(
      "company_product_entitlement_events_source_check",
      sql`${table.source} IN (${sqlStringList(COMPANY_ENTITLEMENT_SOURCES)})`,
    ),
    productCodeCheck: check(
      "company_product_entitlement_events_product_code_check",
      sql`${table.productCode} IN (${sqlStringList(COMPANY_PRODUCT_CODES)})`,
    ),
    validUntilCheck: check(
      "company_product_entitlement_events_valid_until_check",
      sql`${table.source} = 'manual' OR ${table.validUntil} IS NOT NULL`,
    ),
    validPeriodCheck: check(
      "company_product_entitlement_events_valid_period_check",
      sql`(${table.status} = 'active' AND (${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom})) OR (${table.status} IN ('expired', 'revoked') AND ${table.validUntil} IS NOT NULL AND ${table.validUntil} >= ${table.validFrom})`,
    ),
    lifecycleCheck: check(
      "company_product_entitlement_events_lifecycle_check",
      sql`${table.status} = 'active' OR ${table.validUntil} IS NOT NULL`,
    ),
  }),
);

export type CompanyProductEntitlementEvent = InferSelectModel<
  typeof companyProductEntitlementEvent
>;

export const companyModuleSubscription = pgTable(
  "company_module_subscriptions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    billingUserId: uuid("billing_user_id")
      .notNull()
      .references(() => user.id),
    offerCode: varchar("offer_code", { enum: [...COMPANY_OFFER_CODES] })
      .$type<CompanyOfferCode>()
      .notNull(),
    status: varchar("status", {
      enum: [...COMPANY_MODULE_SUBSCRIPTION_STATUSES],
    })
      .$type<CompanyModuleSubscriptionStatus>()
      .notNull(),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    stripePriceId: varchar("stripe_price_id", { length: 255 }).notNull(),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at"),
    lastProviderEventAt: timestamp("last_provider_event_at"),
    lastProviderEventId: varchar("last_provider_event_id", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    stripeSubscriptionUnique: uniqueIndex(
      "company_module_subscriptions_stripe_subscription_unique",
    )
      .on(table.stripeSubscriptionId)
      .where(sql`${table.stripeSubscriptionId} IS NOT NULL`),
    companyIdx: index("company_module_subscriptions_company_idx").on(
      table.companyId,
    ),
    statusCheck: check(
      "company_module_subscriptions_status_check",
      sql`${table.status} IN (${sqlStringList(COMPANY_MODULE_SUBSCRIPTION_STATUSES)})`,
    ),
    offerCodeCheck: check(
      "company_module_subscriptions_offer_code_check",
      sql`${table.offerCode} IN (${sqlStringList(COMPANY_OFFER_CODES)})`,
    ),
  }),
);

export type CompanyModuleSubscription = InferSelectModel<
  typeof companyModuleSubscription
>;

export const companyMemberAccessGrant = pgTable(
  "company_member_access_grants",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    userId: uuid("user_id").notNull(),
    capability: varchar("capability", { enum: [...COMPANY_CAPABILITIES] })
      .$type<CompanyCapability>()
      .notNull(),
    locationId: uuid("location_id"),
    grantedByUserId: uuid("granted_by_user_id")
      .notNull()
      .references(() => user.id),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    membershipFk: foreignKey({
      columns: [table.userId, table.companyId],
      foreignColumns: [userCompany.userId, userCompany.companyId],
      name: "company_member_access_grants_membership_fk",
    }).onDelete("cascade"),
    locationCompanyFk: foreignKey({
      columns: [table.locationId, table.companyId],
      foreignColumns: [companyLocation.id, companyLocation.companyId],
      name: "company_member_access_grants_location_company_fk",
    }).onDelete("cascade"),
    scopeUnique: uniqueIndex("company_member_access_grants_scope_unique").on(
      table.companyId,
      table.userId,
      table.capability,
      sql`COALESCE(${table.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    memberIdx: index("company_member_access_grants_member_idx").on(
      table.companyId,
      table.userId,
    ),
    capabilityCheck: check(
      "company_member_access_grants_capability_check",
      sql`${table.capability} IN (${sqlStringList(COMPANY_CAPABILITIES)})`,
    ),
  }),
);

export type CompanyMemberAccessGrant = InferSelectModel<
  typeof companyMemberAccessGrant
>;

export const companyInvitation = pgTable(
  "company_invitations",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    companyRole: varchar("company_role", { enum: [...COMPANY_INVITATION_ROLES] })
      .notNull()
      .default("member"),
    tokenHash: text("token_hash").notNull(),
    status: varchar("status", { enum: [...COMPANY_INVITATION_STATUSES] })
      .$type<CompanyInvitationStatus>()
      .notNull()
      .default("pending"),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => user.id),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => user.id),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    idCompanyUnique: unique("company_invitations_id_company_unique").on(
      table.id,
      table.companyId,
    ),
    tokenHashUnique: unique("company_invitations_token_hash_unique").on(
      table.tokenHash,
    ),
    companyStatusIdx: index("company_invitations_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    expiresAtIdx: index("company_invitations_expires_at_idx").on(
      table.expiresAt,
    ),
    statusCheck: check(
      "company_invitations_status_check",
      sql`${table.status} IN (${sqlStringList(COMPANY_INVITATION_STATUSES)})`,
    ),
    companyRoleCheck: check(
      "company_invitations_company_role_check",
      sql`${table.companyRole} IN (${sqlStringList(COMPANY_INVITATION_ROLES)})`,
    ),
    expiryCheck: check(
      "company_invitations_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    lifecycleCheck: check(
      "company_invitations_lifecycle_check",
      sql`(${table.status} = 'pending' AND ${table.acceptedByUserId} IS NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL) OR (${table.status} = 'accepted' AND ${table.acceptedByUserId} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL AND ${table.acceptedAt} >= ${table.createdAt} AND ${table.acceptedAt} <= ${table.expiresAt} AND ${table.revokedAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.acceptedByUserId} IS NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NOT NULL AND ${table.revokedAt} >= ${table.createdAt}) OR (${table.status} = 'expired' AND ${table.acceptedByUserId} IS NULL AND ${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL)`,
    ),
  }),
);

export type CompanyInvitation = InferSelectModel<typeof companyInvitation>;

export const companyInvitationGrant = pgTable(
  "company_invitation_grants",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    invitationId: uuid("invitation_id").notNull(),
    companyId: uuid("company_id").notNull(),
    capability: varchar("capability", { enum: [...COMPANY_CAPABILITIES] })
      .$type<CompanyCapability>()
      .notNull(),
    locationId: uuid("location_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    invitationCompanyFk: foreignKey({
      columns: [table.invitationId, table.companyId],
      foreignColumns: [companyInvitation.id, companyInvitation.companyId],
      name: "company_invitation_grants_invitation_company_fk",
    }).onDelete("cascade"),
    locationCompanyFk: foreignKey({
      columns: [table.locationId, table.companyId],
      foreignColumns: [companyLocation.id, companyLocation.companyId],
      name: "company_invitation_grants_location_company_fk",
    }).onDelete("cascade"),
    scopeUnique: uniqueIndex("company_invitation_grants_scope_unique").on(
      table.invitationId,
      table.capability,
      sql`COALESCE(${table.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    capabilityCheck: check(
      "company_invitation_grants_capability_check",
      sql`${table.capability} IN (${sqlStringList(COMPANY_CAPABILITIES)})`,
    ),
  }),
);

export type CompanyInvitationGrant = InferSelectModel<
  typeof companyInvitationGrant
>;

// ===== END company_access_* =====

// ===== BEGIN food_service_* — bloco espelhado byte a byte no projeto irmão =====

export const foodServiceSettings = pgTable(
  "food_service_settings",
  {
    locationId: uuid("location_id")
      .primaryKey()
      .notNull()
      .references(() => companyLocation.id, { onDelete: "cascade" }),
    acceptanceMode: varchar("acceptance_mode", {
      enum: ["automatic", "manual"],
    })
      .notNull()
      .default("automatic"),
    allowNegativeStock: boolean("allow_negative_stock").notNull().default(false),
    paymentReservationMinutes: integer("payment_reservation_minutes")
      .notNull()
      .default(15),
    defaultPreparationMinutes: integer("default_preparation_minutes")
      .notNull()
      .default(30),
    pickupEnabled: boolean("pickup_enabled").notNull().default(true),
    deliveryEnabled: boolean("delivery_enabled").notNull().default(false),
    counterEnabled: boolean("counter_enabled").notNull().default(false),
    tableEnabled: boolean("table_enabled").notNull().default(false),
    minimumOrderCentavos: integer("minimum_order_centavos")
      .notNull()
      .default(0),
    deliveryFeeCentavos: integer("delivery_fee_centavos")
      .notNull()
      .default(0),
    deliveryAreas: jsonb("delivery_areas")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    reservationMinutesCheck: check(
      "food_service_settings_reservation_minutes_check",
      sql`${table.paymentReservationMinutes} BETWEEN 1 AND 1440`,
    ),
    preparationMinutesCheck: check(
      "food_service_settings_preparation_minutes_check",
      sql`${table.defaultPreparationMinutes} BETWEEN 1 AND 1440`,
    ),
    commercialAmountsCheck: check(
      "food_service_settings_commercial_amounts_check",
      sql`${table.minimumOrderCentavos} >= 0 AND ${table.deliveryFeeCentavos} >= 0`,
    ),
    lotTrackingCheck: check(
      "food_service_settings_lot_tracking_check",
      sql`${table.allowNegativeStock} = false`,
    ),
  }),
);

export type FoodServiceSettings = InferSelectModel<typeof foodServiceSettings>;

export const foodServiceMenu = pgTable(
  "food_service_menus",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 120 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    logoUrl: text("logo_url"),
    brandColor: varchar("brand_color", { length: 16 }),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    idCompanyUnique: unique("food_service_menus_id_company_unique").on(
      table.id,
      table.companyId,
    ),
    slugUnique: uniqueIndex("food_service_menus_slug_unique").on(table.slug),
    companyIdx: index("food_service_menus_company_id_idx").on(table.companyId),
    slugCheck: check(
      "food_service_menus_slug_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
  }),
);

export type FoodServiceMenu = InferSelectModel<typeof foodServiceMenu>;

export const foodServiceCategory = pgTable(
  "food_service_categories",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => foodServiceMenu.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    menuPositionIdx: index(
      "food_service_categories_menu_position_idx",
    ).on(table.menuId, table.position),
  }),
);

export type FoodServiceCategory = InferSelectModel<typeof foodServiceCategory>;

export const foodServiceItem = pgTable(
  "food_service_items",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => foodServiceCategory.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    basePriceCentavos: integer("base_price_centavos").notNull(),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    featured: boolean("featured").notNull().default(false),
    preparationMinutes: integer("preparation_minutes"),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    categoryPositionIdx: index(
      "food_service_items_category_position_idx",
    ).on(table.categoryId, table.position),
    priceCheck: check(
      "food_service_items_price_check",
      sql`${table.basePriceCentavos} >= 0`,
    ),
    preparationCheck: check(
      "food_service_items_preparation_check",
      sql`${table.preparationMinutes} IS NULL OR ${table.preparationMinutes} > 0`,
    ),
  }),
);

export type FoodServiceItem = InferSelectModel<typeof foodServiceItem>;

export const foodServiceOptionGroup = pgTable(
  "food_service_option_groups",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    minSelections: integer("min_selections").notNull().default(0),
    maxSelections: integer("max_selections").notNull().default(1),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("food_service_option_groups_company_id_idx").on(
      table.companyId,
    ),
    selectionCheck: check(
      "food_service_option_groups_selection_check",
      sql`${table.minSelections} >= 0 AND ${table.maxSelections} >= ${table.minSelections}`,
    ),
  }),
);

export type FoodServiceOptionGroup = InferSelectModel<
  typeof foodServiceOptionGroup
>;

export const foodServiceOption = pgTable(
  "food_service_options",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => foodServiceOptionGroup.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    priceDeltaCentavos: integer("price_delta_centavos").notNull().default(0),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    groupPositionIdx: index("food_service_options_group_position_idx").on(
      table.groupId,
      table.position,
    ),
  }),
);

export type FoodServiceOption = InferSelectModel<typeof foodServiceOption>;

export const foodServiceItemOptionGroup = pgTable(
  "food_service_item_option_groups",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => foodServiceItem.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => foodServiceOptionGroup.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.itemId, table.groupId] }),
    itemPositionIdx: index(
      "food_service_item_option_groups_item_position_idx",
    ).on(table.itemId, table.position),
  }),
);

export type FoodServiceItemOptionGroup = InferSelectModel<
  typeof foodServiceItemOptionGroup
>;

export const foodServiceUnitItemOverride = pgTable(
  "food_service_unit_item_overrides",
  {
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => foodServiceItem.id, { onDelete: "cascade" }),
    priceCentavos: integer("price_centavos"),
    active: boolean("active"),
    manuallyAvailable: boolean("manually_available"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.locationId, table.itemId] }),
    itemIdx: index("food_service_unit_item_overrides_item_id_idx").on(
      table.itemId,
    ),
    priceCheck: check(
      "food_service_unit_item_overrides_price_check",
      sql`${table.priceCentavos} IS NULL OR ${table.priceCentavos} >= 0`,
    ),
  }),
);

export type FoodServiceUnitItemOverride = InferSelectModel<
  typeof foodServiceUnitItemOverride
>;

export const foodServiceIngredient = pgTable(
  "food_service_ingredients",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    baseUnit: varchar("base_unit", {
      enum: ["g", "ml", "unit"],
    }).notNull(),
    sku: varchar("sku", { length: 80 }),
    minimumQuantityMicros: numeric("minimum_quantity_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyNameUnique: uniqueIndex(
      "food_service_ingredients_company_name_unique",
    ).on(table.companyId, table.name),
    companyIdx: index("food_service_ingredients_company_id_idx").on(
      table.companyId,
    ),
    minimumCheck: check(
      "food_service_ingredients_minimum_check",
      sql`${table.minimumQuantityMicros} >= 0`,
    ),
  }),
);

export type FoodServiceIngredient = InferSelectModel<
  typeof foodServiceIngredient
>;

export const foodServiceRecipeVersion = pgTable(
  "food_service_recipe_versions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    itemId: uuid("item_id").references(() => foodServiceItem.id, {
      onDelete: "cascade",
    }),
    optionId: uuid("option_id").references(() => foodServiceOption.id, {
      onDelete: "cascade",
    }),
    version: integer("version").notNull(),
    yieldQuantityMicros: numeric("yield_quantity_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("1000000"),
    active: boolean("active").notNull().default(true),
    validFrom: timestamp("valid_from").notNull().defaultNow(),
    validTo: timestamp("valid_to"),
    createdByUserId: uuid("created_by_user_id").references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    itemIdx: index("food_service_recipe_versions_item_id_idx").on(table.itemId),
    optionIdx: index("food_service_recipe_versions_option_id_idx").on(
      table.optionId,
    ),
    itemVersionUnique: uniqueIndex(
      "food_service_recipe_versions_item_version_unique",
    )
      .on(table.itemId, table.version)
      .where(sql`${table.itemId} IS NOT NULL`),
    optionVersionUnique: uniqueIndex(
      "food_service_recipe_versions_option_version_unique",
    )
      .on(table.optionId, table.version)
      .where(sql`${table.optionId} IS NOT NULL`),
    targetCheck: check(
      "food_service_recipe_versions_target_check",
      sql`(${table.itemId} IS NOT NULL AND ${table.optionId} IS NULL) OR (${table.itemId} IS NULL AND ${table.optionId} IS NOT NULL)`,
    ),
    versionCheck: check(
      "food_service_recipe_versions_version_check",
      sql`${table.version} > 0 AND ${table.yieldQuantityMicros} > 0`,
    ),
  }),
);

export type FoodServiceRecipeVersion = InferSelectModel<
  typeof foodServiceRecipeVersion
>;

export const foodServiceRecipeComponent = pgTable(
  "food_service_recipe_components",
  {
    recipeVersionId: uuid("recipe_version_id")
      .notNull()
      .references(() => foodServiceRecipeVersion.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    quantityMicros: numeric("quantity_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.recipeVersionId, table.ingredientId],
    }),
    ingredientIdx: index(
      "food_service_recipe_components_ingredient_id_idx",
    ).on(table.ingredientId),
    quantityCheck: check(
      "food_service_recipe_components_quantity_check",
      sql`${table.quantityMicros} > 0`,
    ),
  }),
);

export type FoodServiceRecipeComponent = InferSelectModel<
  typeof foodServiceRecipeComponent
>;

export const foodServiceCart = pgTable(
  "food_service_carts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    channel: varchar("channel", {
      enum: ["web", "whatsapp", "operator", "integration"],
    }).notNull(),
    fulfillmentType: varchar("fulfillment_type", {
      enum: ["delivery", "pickup", "counter", "table"],
    }).notNull(),
    status: varchar("status", {
      enum: ["active", "converted", "abandoned", "expired"],
    })
      .notNull()
      .default("active"),
    customerTokenHash: text("customer_token_hash"),
    revision: integer("revision").notNull().default(0),
    scheduledFor: timestamp("scheduled_for"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    locationStatusIdx: index(
      "food_service_carts_location_status_idx",
    ).on(table.locationId, table.status, table.updatedAt),
    customerTokenUnique: uniqueIndex(
      "food_service_carts_location_customer_token_unique",
    ).on(table.locationId, table.customerTokenHash),
    revisionCheck: check(
      "food_service_carts_revision_check",
      sql`${table.revision} >= 0`,
    ),
  }),
);

export type FoodServiceCart = InferSelectModel<typeof foodServiceCart>;

export type FoodServiceSelectedOptionSnapshot = {
  optionId: string;
  name: string;
  quantity: number;
  unitPriceCentavos: number;
};

export const foodServiceCartItem = pgTable(
  "food_service_cart_items",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => foodServiceCart.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => foodServiceItem.id),
    quantity: integer("quantity").notNull(),
    selectedOptions: jsonb("selected_options")
      .$type<FoodServiceSelectedOptionSnapshot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    cartIdx: index("food_service_cart_items_cart_id_idx").on(table.cartId),
    quantityCheck: check(
      "food_service_cart_items_quantity_check",
      sql`${table.quantity} > 0`,
    ),
  }),
);

export type FoodServiceCartItem = InferSelectModel<typeof foodServiceCartItem>;

export type FoodServiceOrderChannel =
  | "web"
  | "whatsapp"
  | "operator"
  | "integration";

export type FoodServiceOrderStatus =
  | "received"
  | "accepted"
  | "preparing"
  | "ready"
  | "dispatched"
  | "completed"
  | "rejected"
  | "cancelled"
  | "expired";

export type FoodServicePaymentStatus =
  | "not_required"
  | "pending"
  | "approved"
  | "failed"
  | "refunded";

export type FoodServiceCostCompleteness =
  | "complete"
  | "missing_recipe"
  | "missing_cost";

export const foodServiceOrder = pgTable(
  "food_service_orders",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    displayNumber: bigserial("display_number", { mode: "number" }).notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => foodServiceMenu.id),
    cartId: uuid("cart_id").references(() => foodServiceCart.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    status: varchar("status", { length: 24 })
      .$type<FoodServiceOrderStatus>()
      .notNull(),
    paymentStatus: varchar("payment_status", { length: 24 })
      .$type<FoodServicePaymentStatus>()
      .notNull()
      .default("not_required"),
    fulfillmentType: varchar("fulfillment_type", {
      enum: ["delivery", "pickup", "counter", "table"],
    }).notNull(),
    channel: varchar("channel", { length: 24 })
      .$type<FoodServiceOrderChannel>()
      .notNull(),
    customerName: varchar("customer_name", { length: 160 }).notNull(),
    customerPhone: varchar("customer_phone", { length: 24 }).notNull(),
    customerEmail: varchar("customer_email", { length: 160 }),
    fulfillmentDetails: jsonb("fulfillment_details")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    notes: text("notes"),
    scheduledFor: timestamp("scheduled_for"),
    reservationExpiresAt: timestamp("reservation_expires_at"),
    subtotalCentavos: integer("subtotal_centavos").notNull(),
    discountCentavos: integer("discount_centavos").notNull().default(0),
    deliveryFeeCentavos: integer("delivery_fee_centavos").notNull().default(0),
    totalCentavos: integer("total_centavos").notNull(),
    theoreticalCmvCentavos: integer("theoretical_cmv_centavos"),
    realizedCmvCentavos: integer("realized_cmv_centavos"),
    costCompleteness: varchar("cost_completeness", {
      enum: ["complete", "missing_recipe", "missing_cost"],
    })
      .$type<FoodServiceCostCompleteness>()
      .notNull()
      .default("missing_recipe"),
    acceptedAt: timestamp("accepted_at"),
    preparationStartedAt: timestamp("preparation_started_at"),
    readyAt: timestamp("ready_at"),
    dispatchedAt: timestamp("dispatched_at"),
    completedAt: timestamp("completed_at"),
    rejectedAt: timestamp("rejected_at"),
    expiredAt: timestamp("expired_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    locationIdempotencyUnique: uniqueIndex(
      "food_service_orders_location_idempotency_unique",
    ).on(table.locationId, table.idempotencyKey),
    displayNumberUnique: uniqueIndex(
      "food_service_orders_display_number_unique",
    ).on(table.displayNumber),
    locationStatusIdx: index(
      "food_service_orders_location_status_idx",
    ).on(table.locationId, table.status, table.createdAt),
    companyCreatedIdx: index(
      "food_service_orders_company_created_idx",
    ).on(table.companyId, table.createdAt),
    amountCheck: check(
      "food_service_orders_amount_check",
      sql`${table.subtotalCentavos} >= 0 AND ${table.discountCentavos} >= 0 AND ${table.discountCentavos} <= ${table.subtotalCentavos} AND ${table.deliveryFeeCentavos} >= 0 AND ${table.totalCentavos} = ${table.subtotalCentavos} - ${table.discountCentavos} + ${table.deliveryFeeCentavos}`,
    ),
    costCompletenessCheck: check(
      "food_service_orders_cost_completeness_check",
      sql`${table.costCompleteness} IN ('complete', 'missing_recipe', 'missing_cost')`,
    ),
  }),
);

export type FoodServiceOrder = InferSelectModel<typeof foodServiceOrder>;

export type FoodServiceRecipeSnapshotComponent = {
  ingredientId: string;
  ingredientName: string;
  quantityMicros: string;
  unitCostMicrocentavos: string;
};

export const foodServiceOrderItem = pgTable(
  "food_service_order_items",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => foodServiceOrder.id),
    itemId: uuid("item_id").references(() => foodServiceItem.id, {
      onDelete: "set null",
    }),
    itemNameSnapshot: varchar("item_name_snapshot", { length: 160 }).notNull(),
    categoryNameSnapshot: varchar("category_name_snapshot", { length: 120 }).notNull(),
    unitPriceCentavos: integer("unit_price_centavos").notNull(),
    quantity: integer("quantity").notNull(),
    selectedOptions: jsonb("selected_options")
      .$type<FoodServiceSelectedOptionSnapshot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    recipeSnapshot: jsonb("recipe_snapshot")
      .$type<FoodServiceRecipeSnapshotComponent[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    theoreticalCmvCentavos: integer("theoretical_cmv_centavos"),
    costCompleteness: varchar("cost_completeness", {
      enum: ["complete", "missing_recipe", "missing_cost"],
    })
      .$type<FoodServiceCostCompleteness>()
      .notNull()
      .default("missing_recipe"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orderIdx: index("food_service_order_items_order_id_idx").on(table.orderId),
    quantityAndPriceCheck: check(
      "food_service_order_items_quantity_price_check",
      sql`${table.quantity} > 0 AND ${table.unitPriceCentavos} >= 0`,
    ),
    costCompletenessCheck: check(
      "food_service_order_items_cost_completeness_check",
      sql`${table.costCompleteness} IN ('complete', 'missing_recipe', 'missing_cost')`,
    ),
  }),
);

export type FoodServiceOrderItem = InferSelectModel<
  typeof foodServiceOrderItem
>;

export const foodServiceOrderEvent = pgTable(
  "food_service_order_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey().notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => foodServiceOrder.id),
    type: varchar("type", { length: 48 }).notNull(),
    fromStatus: varchar("from_status", { length: 24 }),
    toStatus: varchar("to_status", { length: 24 }),
    source: varchar("source", {
      enum: ["web", "whatsapp", "operator", "integration", "system"],
    }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orderIdx: index("food_service_order_events_order_id_idx").on(
      table.orderId,
      table.id,
    ),
  }),
);

export type FoodServiceOrderEvent = InferSelectModel<
  typeof foodServiceOrderEvent
>;

export const foodServiceWhatsappConnection = pgTable(
  "food_service_whatsapp_connections",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id, { onDelete: "cascade" }),
    phoneNumberId: varchar("phone_number_id", { length: 64 }).notNull(),
    wabaId: varchar("waba_id", { length: 64 }).notNull(),
    displayPhoneE164: varchar("display_phone_e164", { length: 24 }).notNull(),
    status: varchar("status", {
      enum: ["pending", "connected", "disconnected"],
    })
      .notNull()
      .default("pending"),
    credentialReference: text("credential_reference"),
    connectedAt: timestamp("connected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    phoneNumberUnique: uniqueIndex(
      "food_service_whatsapp_connections_phone_number_unique",
    ).on(table.phoneNumberId),
    locationUnique: uniqueIndex(
      "food_service_whatsapp_connections_location_unique",
    ).on(table.locationId),
    companyIdx: index(
      "food_service_whatsapp_connections_company_idx",
    ).on(table.companyId),
  }),
);

export type FoodServiceWhatsappConnection = InferSelectModel<
  typeof foodServiceWhatsappConnection
>;

export const foodServiceWhatsappOperator = pgTable(
  "food_service_whatsapp_operators",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => foodServiceWhatsappConnection.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    phoneE164: varchar("phone_e164", { length: 24 }).notNull(),
    role: varchar("role", { enum: ["owner", "admin", "member"] }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.connectionId, table.userId] }),
    contactUnique: uniqueIndex(
      "food_service_whatsapp_operators_contact_unique",
    ).on(table.connectionId, table.phoneE164),
  }),
);

export const foodServiceWhatsappConsumerSession = pgTable(
  "food_service_whatsapp_consumer_sessions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => foodServiceWhatsappConnection.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id, { onDelete: "cascade" }),
    customerPhoneE164: varchar("customer_phone_e164", { length: 24 }).notNull(),
    activeCartId: uuid("active_cart_id").references(() => foodServiceCart.id),
    lastOrderId: uuid("last_order_id").references(() => foodServiceOrder.id),
    lastInboundMessageId: varchar("last_inbound_message_id", { length: 255 }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    contactUnique: uniqueIndex(
      "food_service_whatsapp_consumer_sessions_contact_unique",
    ).on(table.connectionId, table.customerPhoneE164),
    expiryIdx: index(
      "food_service_whatsapp_consumer_sessions_expiry_idx",
    ).on(table.expiresAt),
  }),
);

export const foodServiceWhatsappOutbox = pgTable(
  "food_service_whatsapp_outbox",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => foodServiceWhatsappConnection.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => foodServiceOrder.id),
    recipientPhoneE164: varchar("recipient_phone_e164", { length: 24 }).notNull(),
    purpose: varchar("purpose", {
      enum: [
        "consumer_reply",
        "order_received",
        "order_accepted",
        "order_status",
      ],
    }).notNull(),
    body: text("body").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    status: varchar("status", {
      enum: ["pending", "sending", "sent", "failed"],
    })
      .notNull()
      .default("pending"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex(
      "food_service_whatsapp_outbox_idempotency_unique",
    ).on(table.connectionId, table.idempotencyKey),
    pendingIdx: index("food_service_whatsapp_outbox_pending_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);

export const foodServiceWhatsappInbox = pgTable(
  "food_service_whatsapp_inbox",
  {
    messageId: varchar("message_id", { length: 255 }).primaryKey().notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => foodServiceWhatsappConnection.id, { onDelete: "cascade" }),
    consumerSessionId: uuid("consumer_session_id").references(
      () => foodServiceWhatsappConsumerSession.id,
    ),
    operatorUserId: uuid("operator_user_id").references(() => user.id),
    senderPhoneE164: varchar("sender_phone_e164", { length: 24 }).notNull(),
    role: varchar("role", { enum: ["operator", "consumer"] }).notNull(),
    text: text("text").notNull(),
    status: varchar("status", {
      enum: ["pending", "processing", "processed", "failed"],
    })
      .notNull()
      .default("pending"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pendingIdx: index("food_service_whatsapp_inbox_pending_idx").on(
      table.status,
      table.createdAt,
    ),
  }),
);

export const foodServicePayment = pgTable(
  "food_service_payments",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => foodServiceOrder.id),
    provider: varchar("provider", {
      enum: ["external", "mercadopago"],
    }).notNull(),
    method: varchar("method", {
      enum: ["pix", "credit_card", "debit_card", "cash", "other"],
    }).notNull(),
    status: varchar("status", { length: 24 })
      .$type<FoodServicePaymentStatus>()
      .notNull(),
    providerPaymentId: text("provider_payment_id"),
    providerPreferenceId: text("provider_preference_id"),
    amountCentavos: integer("amount_centavos").notNull(),
    feeCentavos: integer("fee_centavos"),
    automatizeCommissionCentavos: integer("automatize_commission_centavos"),
    rawStatus: text("raw_status"),
    approvedAt: timestamp("approved_at"),
    refundedAt: timestamp("refunded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    orderIdx: index("food_service_payments_order_id_idx").on(table.orderId),
    providerPaymentUnique: uniqueIndex(
      "food_service_payments_provider_payment_unique",
    ).on(table.provider, table.providerPaymentId),
    amountCheck: check(
      "food_service_payments_amount_check",
      sql`${table.amountCentavos} >= 0 AND (${table.feeCentavos} IS NULL OR ${table.feeCentavos} >= 0) AND (${table.automatizeCommissionCentavos} IS NULL OR ${table.automatizeCommissionCentavos} >= 0) AND COALESCE(${table.feeCentavos}, 0) + COALESCE(${table.automatizeCommissionCentavos}, 0) <= ${table.amountCentavos}`,
    ),
  }),
);

export type FoodServicePayment = InferSelectModel<typeof foodServicePayment>;

export const foodServiceSupplier = pgTable(
  "food_service_suppliers",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => company.id),
    name: varchar("name", { length: 160 }).notNull(),
    legalName: varchar("legal_name", { length: 200 }),
    cnpj: varchar("cnpj", { length: 14 }),
    phone: varchar("phone", { length: 24 }),
    email: varchar("email", { length: 160 }),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyNameUnique: uniqueIndex(
      "food_service_suppliers_company_name_unique",
    ).on(table.companyId, table.name),
    companyCnpjUnique: uniqueIndex(
      "food_service_suppliers_company_cnpj_unique",
    )
      .on(table.companyId, table.cnpj)
      .where(sql`${table.cnpj} IS NOT NULL`),
    cnpjCheck: check(
      "food_service_suppliers_cnpj_check",
      sql`${table.cnpj} IS NULL OR ${table.cnpj} ~ '^[0-9]{14}$'`,
    ),
  }),
);

export type FoodServiceSupplier = InferSelectModel<typeof foodServiceSupplier>;

export const foodServicePurchaseOrder = pgTable(
  "food_service_purchase_orders",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    displayNumber: bigserial("display_number", { mode: "number" }).notNull(),
    companyId: uuid("company_id").notNull().references(() => company.id),
    locationId: uuid("location_id").notNull().references(() => companyLocation.id),
    supplierId: uuid("supplier_id").notNull().references(() => foodServiceSupplier.id),
    status: varchar("status", {
      enum: ["draft", "placed", "partially_received", "received", "closed", "cancelled"],
    }).notNull().default("draft"),
    expectedOn: date("expected_on"),
    notes: text("notes"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    closeReason: text("close_reason"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    placedAt: timestamp("placed_at"),
    closedAt: timestamp("closed_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    displayNumberUnique: uniqueIndex(
      "food_service_purchase_orders_display_number_unique",
    ).on(table.displayNumber),
    locationStatusIdx: index(
      "food_service_purchase_orders_location_status_idx",
    ).on(table.locationId, table.status, table.createdAt),
    locationIdempotencyUnique: uniqueIndex(
      "food_service_purchase_orders_location_idempotency_unique",
    ).on(table.locationId, table.idempotencyKey),
    statusCheck: check(
      "food_service_purchase_orders_status_check",
      sql`${table.status} IN ('draft','placed','partially_received','received','closed','cancelled')`,
    ),
  }),
);

export type FoodServicePurchaseOrder = InferSelectModel<
  typeof foodServicePurchaseOrder
>;

export const foodServicePurchaseOrderLine = pgTable(
  "food_service_purchase_order_lines",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => foodServicePurchaseOrder.id),
    ingredientId: uuid("ingredient_id").notNull().references(() => foodServiceIngredient.id),
    ingredientNameSnapshot: varchar("ingredient_name_snapshot", { length: 160 }).notNull(),
    purchaseUnitLabel: varchar("purchase_unit_label", { length: 80 }).notNull(),
    orderedPurchaseUnitsMicros: numeric("ordered_purchase_units_micros", { precision: 24, scale: 0 }).notNull(),
    conversionFactorMicros: numeric("conversion_factor_micros", { precision: 24, scale: 0 }).notNull(),
    orderedBaseQuantityMicros: numeric("ordered_base_quantity_micros", { precision: 24, scale: 0 }).notNull(),
    expectedUnitCostMicrocentavos: numeric("expected_unit_cost_microcentavos", { precision: 30, scale: 0 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orderIngredientUnique: uniqueIndex(
      "food_service_purchase_order_lines_order_ingredient_unique",
    ).on(table.purchaseOrderId, table.ingredientId),
    valuesCheck: check(
      "food_service_purchase_order_lines_values_check",
      sql`${table.orderedPurchaseUnitsMicros} > 0 AND ${table.conversionFactorMicros} > 0 AND ${table.orderedBaseQuantityMicros} > 0 AND ${table.expectedUnitCostMicrocentavos} >= 0`,
    ),
    conversionCheck: check(
      "food_service_purchase_order_lines_conversion_check",
      sql`${table.orderedBaseQuantityMicros} = (${table.orderedPurchaseUnitsMicros} * ${table.conversionFactorMicros}) / 1000000`,
    ),
  }),
);

export type FoodServicePurchaseOrderLine = InferSelectModel<
  typeof foodServicePurchaseOrderLine
>;

export const foodServiceGoodsReceipt = pgTable(
  "food_service_goods_receipts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => foodServicePurchaseOrder.id),
    companyId: uuid("company_id").notNull().references(() => company.id),
    locationId: uuid("location_id").notNull().references(() => companyLocation.id),
    supplierId: uuid("supplier_id").notNull().references(() => foodServiceSupplier.id),
    status: varchar("status", { enum: ["posted", "cancelled"] }).notNull().default("posted"),
    documentNumber: varchar("document_number", { length: 120 }),
    receivedAt: timestamp("received_at").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    notes: text("notes"),
    postedByUserId: uuid("posted_by_user_id").notNull().references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orderIdempotencyUnique: uniqueIndex(
      "food_service_goods_receipts_order_idempotency_unique",
    ).on(table.purchaseOrderId, table.idempotencyKey),
    supplierDocumentUnique: uniqueIndex(
      "food_service_goods_receipts_supplier_document_unique",
    )
      .on(table.companyId, table.supplierId, table.documentNumber)
      .where(sql`${table.documentNumber} IS NOT NULL`),
    statusCheck: check(
      "food_service_goods_receipts_status_check",
      sql`${table.status} IN ('posted','cancelled')`,
    ),
  }),
);

export type FoodServiceGoodsReceipt = InferSelectModel<
  typeof foodServiceGoodsReceipt
>;

export const foodServicePurchaseOrderEvent = pgTable(
  "food_service_purchase_order_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey().notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => foodServicePurchaseOrder.id),
    type: varchar("type", { length: 48 }).notNull(),
    fromStatus: varchar("from_status", { length: 32 }),
    toStatus: varchar("to_status", { length: 32 }),
    source: varchar("source", { enum: ["web", "whatsapp", "operator", "integration", "system"] }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orderIdx: index("food_service_purchase_order_events_order_id_idx").on(
      table.purchaseOrderId,
      table.id,
    ),
  }),
);

export type FoodServicePurchaseOrderEvent = InferSelectModel<
  typeof foodServicePurchaseOrderEvent
>;

export const foodServicePurchaseTemplate = pgTable(
  "food_service_purchase_templates",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => foodServiceSupplier.id),
    name: varchar("name", { length: 160 }).notNull(),
    schedule: jsonb("schedule")
      .$type<FoodServiceRoutineSchedule>()
      .notNull()
      .default(sql`'{"frequency":"weekly","weekdays":[1]}'::jsonb`),
    dueTime: varchar("due_time", { length: 5 }),
    expectedLeadDays: integer("expected_lead_days").notNull().default(0),
    notes: text("notes"),
    inputFingerprint: text("input_fingerprint").notNull(),
    active: boolean("active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    locationNameUnique: uniqueIndex(
      "food_service_purchase_templates_location_name_unique",
    ).on(table.locationId, sql`lower(${table.name})`),
    locationActiveIdx: index(
      "food_service_purchase_templates_location_active_idx",
    ).on(table.locationId, table.active, table.dueTime),
    dueTimeCheck: check(
      "food_service_purchase_templates_due_time_check",
      sql`${table.dueTime} IS NULL OR ${table.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    leadDaysCheck: check(
      "food_service_purchase_templates_lead_days_check",
      sql`${table.expectedLeadDays} BETWEEN 0 AND 90`,
    ),
  }),
);

export const foodServicePurchaseTemplateLine = pgTable(
  "food_service_purchase_template_lines",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => foodServicePurchaseTemplate.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    purchaseUnitLabel: varchar("purchase_unit_label", { length: 80 }).notNull(),
    plannedPurchaseUnitsMicros: numeric("planned_purchase_units_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    conversionFactorMicros: numeric("conversion_factor_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    plannedBaseQuantityMicros: numeric("planned_base_quantity_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    expectedUnitCostMicrocentavos: numeric(
      "expected_unit_cost_microcentavos",
      { precision: 30, scale: 0 },
    ).notNull(),
    notes: text("notes"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    templateIngredientUnique: uniqueIndex(
      "food_service_purchase_template_lines_template_ingredient_unique",
    ).on(table.templateId, table.ingredientId),
    templatePositionUnique: uniqueIndex(
      "food_service_purchase_template_lines_template_position_unique",
    ).on(table.templateId, table.position),
    valuesCheck: check(
      "food_service_purchase_template_lines_values_check",
      sql`${table.plannedPurchaseUnitsMicros} > 0 AND ${table.conversionFactorMicros} > 0 AND ${table.plannedBaseQuantityMicros} > 0 AND ${table.expectedUnitCostMicrocentavos} >= 0 AND ${table.position} >= 0`,
    ),
    conversionCheck: check(
      "food_service_purchase_template_lines_conversion_check",
      sql`${table.plannedBaseQuantityMicros} = (${table.plannedPurchaseUnitsMicros} * ${table.conversionFactorMicros}) / 1000000`,
    ),
  }),
);

export const foodServicePurchaseTemplateRun = pgTable(
  "food_service_purchase_template_runs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => foodServicePurchaseTemplate.id),
    operationalDate: date("operational_date").notNull(),
    status: varchar("status", {
      enum: ["pending", "generating", "generated", "skipped"],
    })
      .notNull()
      .default("pending"),
    purchaseOrderId: uuid("purchase_order_id").references(
      () => foodServicePurchaseOrder.id,
    ),
    resolutionReason: text("resolution_reason"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => user.id),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    templateDateUnique: uniqueIndex(
      "food_service_purchase_template_runs_template_date_unique",
    ).on(table.templateId, table.operationalDate),
    purchaseOrderUnique: uniqueIndex(
      "food_service_purchase_template_runs_purchase_order_unique",
    )
      .on(table.purchaseOrderId)
      .where(sql`${table.purchaseOrderId} IS NOT NULL`),
    locationDateIdx: index(
      "food_service_purchase_template_runs_location_date_idx",
    ).on(table.locationId, table.operationalDate, table.status),
    lifecycleCheck: check(
      "food_service_purchase_template_runs_lifecycle_check",
      sql`(${table.status} = 'pending' AND ${table.purchaseOrderId} IS NULL AND ${table.resolutionReason} IS NULL AND ${table.resolvedByUserId} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.status} = 'generating' AND ${table.purchaseOrderId} IS NULL AND ${table.resolutionReason} IS NULL AND ${table.resolvedByUserId} IS NOT NULL AND ${table.resolvedAt} IS NULL) OR (${table.status} = 'generated' AND ${table.purchaseOrderId} IS NOT NULL AND ${table.resolutionReason} IS NULL AND ${table.resolvedByUserId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL) OR (${table.status} = 'skipped' AND ${table.purchaseOrderId} IS NULL AND ${table.resolutionReason} IS NOT NULL AND ${table.resolvedByUserId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`,
    ),
  }),
);

export const foodServiceStockPosition = pgTable(
  "food_service_stock_positions",
  {
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id, { onDelete: "cascade" }),
    physicalQuantityMicros: numeric("physical_quantity_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    reservedQuantityMicros: numeric("reserved_quantity_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    averageCostMicrocentavos: numeric("average_cost_microcentavos", {
      precision: 30,
      scale: 0,
    })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.locationId, table.ingredientId] }),
    ingredientIdx: index(
      "food_service_stock_positions_ingredient_id_idx",
    ).on(table.ingredientId),
    reservedCheck: check(
      "food_service_stock_positions_reserved_check",
      sql`${table.physicalQuantityMicros} >= 0 AND ${table.reservedQuantityMicros} >= 0 AND ${table.reservedQuantityMicros} <= ${table.physicalQuantityMicros}`,
    ),
    costCheck: check(
      "food_service_stock_positions_cost_check",
      sql`${table.averageCostMicrocentavos} >= 0`,
    ),
  }),
);

export type FoodServiceStockPosition = InferSelectModel<
  typeof foodServiceStockPosition
>;

export const foodServiceStockMovement = pgTable(
  "food_service_stock_movements",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    orderId: uuid("order_id").references(() => foodServiceOrder.id),
    kind: varchar("kind", {
      enum: ["entry", "reserve", "release", "consume", "loss", "correction"],
    }).notNull(),
    physicalDeltaMicros: numeric("physical_delta_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    reservedDeltaMicros: numeric("reserved_delta_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    unitCostMicrocentavos: numeric("unit_cost_microcentavos", {
      precision: 30,
      scale: 0,
    }),
    totalCostCentavos: integer("total_cost_centavos"),
    classification: varchar("classification", {
      enum: ["sale_cmv", "waste"],
    }),
    classifiedQuantityMicros: numeric("classified_quantity_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    reclassifiesMovementId: uuid("reclassifies_movement_id"),
    lotCode: varchar("lot_code", { length: 120 }),
    expiresAt: timestamp("expires_at"),
    reason: text("reason"),
    source: varchar("source", {
      enum: ["web", "whatsapp", "operator", "integration", "system"],
    }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => user.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    locationIdempotencyUnique: uniqueIndex(
      "food_service_stock_movements_location_idempotency_unique",
    ).on(table.locationId, table.idempotencyKey),
    locationIngredientCreatedIdx: index(
      "food_service_stock_movements_location_ingredient_created_idx",
    ).on(table.locationId, table.ingredientId, table.createdAt),
    orderIdx: index("food_service_stock_movements_order_id_idx").on(
      table.orderId,
    ),
    reclassificationFk: foreignKey({
      columns: [table.reclassifiesMovementId],
      foreignColumns: [table.id],
      name: "food_service_stock_movements_reclassification_fk",
    }),
    costCheck: check(
      "food_service_stock_movements_cost_check",
      sql`(${table.unitCostMicrocentavos} IS NULL OR ${table.unitCostMicrocentavos} >= 0) AND (${table.totalCostCentavos} IS NULL OR ${table.totalCostCentavos} >= 0)`,
    ),
    classifiedQuantityCheck: check(
      "food_service_stock_movements_classified_quantity_check",
      sql`${table.classifiedQuantityMicros} >= 0`,
    ),
    classificationCheck: check(
      "food_service_stock_movements_classification_check",
      sql`${table.classification} IS NULL OR ${table.classification} IN ('sale_cmv', 'waste')`,
    ),
    classificationValuesCheck: check(
      "food_service_stock_movements_classification_values_check",
      sql`(${table.classification} IS NULL AND ${table.classifiedQuantityMicros} = 0 AND ${table.totalCostCentavos} IS NULL) OR (${table.classification} IS NOT NULL AND ${table.classifiedQuantityMicros} > 0 AND ${table.totalCostCentavos} IS NOT NULL)`,
    ),
    shapeCheck: check(
      "food_service_stock_movements_shape_check",
      sql`(${table.kind} = 'entry' AND ${table.physicalDeltaMicros} > 0 AND ${table.reservedDeltaMicros} = 0 AND ${table.unitCostMicrocentavos} IS NOT NULL AND ${table.reclassifiesMovementId} IS NULL) OR (${table.kind} = 'reserve' AND ${table.physicalDeltaMicros} = 0 AND ${table.reservedDeltaMicros} > 0 AND ${table.reclassifiesMovementId} IS NULL) OR (${table.kind} = 'release' AND ${table.physicalDeltaMicros} = 0 AND ${table.reservedDeltaMicros} < 0 AND ${table.reclassifiesMovementId} IS NULL) OR (${table.kind} = 'consume' AND ${table.physicalDeltaMicros} < 0 AND ${table.reservedDeltaMicros} = ${table.physicalDeltaMicros} AND ${table.classification} = 'sale_cmv' AND ${table.classifiedQuantityMicros} = -${table.physicalDeltaMicros} AND ${table.reclassifiesMovementId} IS NULL) OR (${table.kind} = 'loss' AND ${table.reservedDeltaMicros} = 0 AND ${table.classification} = 'waste' AND ((${table.physicalDeltaMicros} < 0 AND ${table.classifiedQuantityMicros} = -${table.physicalDeltaMicros} AND ${table.reclassifiesMovementId} IS NULL) OR (${table.physicalDeltaMicros} = 0 AND ${table.reclassifiesMovementId} IS NOT NULL))) OR (${table.kind} = 'correction' AND ${table.physicalDeltaMicros} <> 0 AND ${table.reservedDeltaMicros} = 0 AND ${table.reclassifiesMovementId} IS NULL)`,
    ),
    lotCheck: check(
      "food_service_stock_movements_lot_check",
      sql`(${table.lotCode} IS NULL AND ${table.expiresAt} IS NULL) OR ${table.kind} = 'entry'`,
    ),
  }),
);

export type FoodServiceStockMovement = InferSelectModel<
  typeof foodServiceStockMovement
>;

export const foodServiceGoodsReceiptLine = pgTable(
  "food_service_goods_receipt_lines",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    receiptId: uuid("receipt_id").notNull().references(() => foodServiceGoodsReceipt.id),
    purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => foodServicePurchaseOrderLine.id),
    ingredientId: uuid("ingredient_id").notNull().references(() => foodServiceIngredient.id),
    acceptedBaseQuantityMicros: numeric("accepted_base_quantity_micros", { precision: 24, scale: 0 }).notNull().default("0"),
    rejectedBaseQuantityMicros: numeric("rejected_base_quantity_micros", { precision: 24, scale: 0 }).notNull().default("0"),
    actualUnitCostMicrocentavos: numeric("actual_unit_cost_microcentavos", { precision: 30, scale: 0 }),
    rejectionReason: text("rejection_reason"),
    lotCode: varchar("lot_code", { length: 120 }),
    expiresOn: date("expires_on"),
    stockMovementId: uuid("stock_movement_id").references(() => foodServiceStockMovement.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    movementUnique: uniqueIndex(
      "food_service_goods_receipt_lines_movement_unique",
    ).on(table.stockMovementId),
    receiptLineIdx: index(
      "food_service_goods_receipt_lines_receipt_id_idx",
    ).on(table.receiptId),
    quantitiesCheck: check(
      "food_service_goods_receipt_lines_quantities_check",
      sql`${table.acceptedBaseQuantityMicros} >= 0 AND ${table.rejectedBaseQuantityMicros} >= 0 AND (${table.acceptedBaseQuantityMicros} > 0 OR ${table.rejectedBaseQuantityMicros} > 0)`,
    ),
    postingCheck: check(
      "food_service_goods_receipt_lines_posting_check",
      sql`(${table.acceptedBaseQuantityMicros} > 0 AND ${table.actualUnitCostMicrocentavos} IS NOT NULL AND ${table.actualUnitCostMicrocentavos} >= 0 AND ${table.stockMovementId} IS NOT NULL) OR (${table.acceptedBaseQuantityMicros} = 0 AND ${table.actualUnitCostMicrocentavos} IS NULL AND ${table.stockMovementId} IS NULL)`,
    ),
    rejectionCheck: check(
      "food_service_goods_receipt_lines_rejection_check",
      sql`${table.rejectedBaseQuantityMicros} = 0 OR LENGTH(TRIM(COALESCE(${table.rejectionReason}, ''))) >= 3`,
    ),
  }),
);

export type FoodServiceGoodsReceiptLine = InferSelectModel<
  typeof foodServiceGoodsReceiptLine
>;

export const foodServiceStockLot = pgTable(
  "food_service_stock_lots",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    sourceMovementId: uuid("source_movement_id")
      .notNull()
      .references(() => foodServiceStockMovement.id),
    lotCode: varchar("lot_code", { length: 120 }),
    expiresOn: date("expires_on"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    physicalQuantityMicros: numeric("physical_quantity_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    reservedQuantityMicros: numeric("reserved_quantity_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    costStatus: varchar("cost_status", { enum: ["known", "missing"] })
      .notNull()
      .default("known"),
    unitCostMicrocentavos: numeric("unit_cost_microcentavos", {
      precision: 30,
      scale: 0,
    }),
    status: varchar("status", {
      enum: ["active", "depleted", "quarantined"],
    })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    sourceMovementUnique: uniqueIndex(
      "food_service_stock_lots_source_movement_unique",
    ).on(table.sourceMovementId),
    fefoIdx: index("food_service_stock_lots_fefo_idx").on(
      table.locationId,
      table.ingredientId,
      table.status,
      table.expiresOn,
      table.receivedAt,
    ),
    quantitiesCheck: check(
      "food_service_stock_lots_quantities_check",
      sql`${table.physicalQuantityMicros} >= 0 AND ${table.reservedQuantityMicros} >= 0 AND ${table.reservedQuantityMicros} <= ${table.physicalQuantityMicros}`,
    ),
    costCheck: check(
      "food_service_stock_lots_cost_check",
      sql`(${table.costStatus} = 'known' AND ${table.unitCostMicrocentavos} IS NOT NULL AND ${table.unitCostMicrocentavos} >= 0) OR (${table.costStatus} = 'missing' AND ${table.unitCostMicrocentavos} IS NULL)`,
    ),
    statusCheck: check(
      "food_service_stock_lots_status_check",
      sql`(${table.status} = 'depleted' AND ${table.physicalQuantityMicros} = 0 AND ${table.reservedQuantityMicros} = 0) OR (${table.status} IN ('active', 'quarantined') AND ${table.physicalQuantityMicros} > 0)`,
    ),
  }),
);

export type FoodServiceStockLot = InferSelectModel<
  typeof foodServiceStockLot
>;

export const foodServiceStockMovementLot = pgTable(
  "food_service_stock_movement_lots",
  {
    movementId: uuid("movement_id")
      .notNull()
      .references(() => foodServiceStockMovement.id),
    stockLotId: uuid("stock_lot_id")
      .notNull()
      .references(() => foodServiceStockLot.id),
    physicalDeltaMicros: numeric("physical_delta_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    reservedDeltaMicros: numeric("reserved_delta_micros", {
      precision: 24,
      scale: 0,
    })
      .notNull()
      .default("0"),
    unitCostMicrocentavos: numeric("unit_cost_microcentavos", {
      precision: 30,
      scale: 0,
    }).notNull(),
    totalCostCentavos: integer("total_cost_centavos").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.movementId, table.stockLotId] }),
    lotIdx: index("food_service_stock_movement_lots_lot_id_idx").on(
      table.stockLotId,
    ),
    valuesCheck: check(
      "food_service_stock_movement_lots_values_check",
      sql`(${table.physicalDeltaMicros} <> 0 OR ${table.reservedDeltaMicros} <> 0) AND ${table.unitCostMicrocentavos} >= 0 AND ${table.totalCostCentavos} >= 0 AND ${table.totalCostCentavos} = FLOOR((GREATEST(ABS(${table.physicalDeltaMicros}), ABS(${table.reservedDeltaMicros})) * ${table.unitCostMicrocentavos}) / 1000000000000)`,
    ),
  }),
);

export type FoodServiceStockMovementLot = InferSelectModel<
  typeof foodServiceStockMovementLot
>;

export const foodServiceOrderStockReservation = pgTable(
  "food_service_order_stock_reservations",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => foodServiceOrder.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    quantityMicros: numeric("quantity_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    unitCostMicrocentavos: numeric("unit_cost_microcentavos", {
      precision: 30,
      scale: 0,
    }).notNull(),
    status: varchar("status", {
      enum: ["reserved", "consumed", "released", "lost"],
    })
      .notNull()
      .default("reserved"),
    consumedAt: timestamp("consumed_at"),
    releasedAt: timestamp("released_at"),
    lostAt: timestamp("lost_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    orderIngredientUnique: uniqueIndex(
      "food_service_order_stock_reservations_order_ingredient_unique",
    ).on(table.orderId, table.ingredientId),
    locationStatusIdx: index(
      "food_service_order_stock_reservations_location_status_idx",
    ).on(table.locationId, table.status),
    quantityAndCostCheck: check(
      "food_service_order_stock_reservations_quantity_cost_check",
      sql`${table.quantityMicros} > 0 AND ${table.unitCostMicrocentavos} >= 0`,
    ),
    lifecycleCheck: check(
      "food_service_order_stock_reservations_lifecycle_check",
      sql`(${table.status} = 'reserved' AND ${table.consumedAt} IS NULL AND ${table.releasedAt} IS NULL AND ${table.lostAt} IS NULL) OR (${table.status} = 'consumed' AND ${table.consumedAt} IS NOT NULL AND ${table.releasedAt} IS NULL AND ${table.lostAt} IS NULL) OR (${table.status} = 'released' AND ${table.consumedAt} IS NULL AND ${table.releasedAt} IS NOT NULL AND ${table.lostAt} IS NULL) OR (${table.status} = 'lost' AND ${table.consumedAt} IS NOT NULL AND ${table.releasedAt} IS NULL AND ${table.lostAt} IS NOT NULL)`,
    ),
  }),
);

export type FoodServiceOrderStockReservation = InferSelectModel<
  typeof foodServiceOrderStockReservation
>;

export const foodServiceOrderStockAllocation = pgTable(
  "food_service_order_stock_allocations",
  {
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => foodServiceOrderStockReservation.id),
    stockLotId: uuid("stock_lot_id")
      .notNull()
      .references(() => foodServiceStockLot.id),
    quantityMicros: numeric("quantity_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    unitCostMicrocentavos: numeric("unit_cost_microcentavos", {
      precision: 30,
      scale: 0,
    }).notNull(),
    status: varchar("status", {
      enum: ["reserved", "consumed", "released", "lost"],
    })
      .notNull()
      .default("reserved"),
    consumedAt: timestamp("consumed_at"),
    releasedAt: timestamp("released_at"),
    lostAt: timestamp("lost_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.reservationId, table.stockLotId] }),
    lotStatusIdx: index(
      "food_service_order_stock_allocations_lot_status_idx",
    ).on(table.stockLotId, table.status),
    valuesCheck: check(
      "food_service_order_stock_allocations_values_check",
      sql`${table.quantityMicros} > 0 AND ${table.unitCostMicrocentavos} >= 0`,
    ),
    statusCheck: check(
      "food_service_order_stock_allocations_status_check",
      sql`${table.status} IN ('reserved', 'consumed', 'released', 'lost')`,
    ),
    lifecycleCheck: check(
      "food_service_order_stock_allocations_lifecycle_check",
      sql`(${table.status} = 'reserved' AND ${table.consumedAt} IS NULL AND ${table.releasedAt} IS NULL AND ${table.lostAt} IS NULL) OR (${table.status} = 'consumed' AND ${table.consumedAt} IS NOT NULL AND ${table.releasedAt} IS NULL AND ${table.lostAt} IS NULL) OR (${table.status} = 'released' AND ${table.consumedAt} IS NULL AND ${table.releasedAt} IS NOT NULL AND ${table.lostAt} IS NULL) OR (${table.status} = 'lost' AND ${table.consumedAt} IS NOT NULL AND ${table.releasedAt} IS NULL AND ${table.lostAt} IS NOT NULL)`,
    ),
  }),
);

export type FoodServiceOrderStockAllocation = InferSelectModel<
  typeof foodServiceOrderStockAllocation
>;


export const foodServiceInventoryCount = pgTable(
  "food_service_inventory_counts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    status: varchar("status", {
      enum: ["completed", "cancelled"],
    })
      .notNull()
      .default("completed"),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    notes: text("notes"),
    countedByUserId: uuid("counted_by_user_id")
      .notNull()
      .references(() => user.id),
    countedAt: timestamp("counted_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    locationIdempotencyUnique: uniqueIndex(
      "food_service_inventory_counts_location_idempotency_unique",
    ).on(table.locationId, table.idempotencyKey),
    locationCountedIdx: index(
      "food_service_inventory_counts_location_counted_idx",
    ).on(table.locationId, table.countedAt),
    statusCheck: check(
      "food_service_inventory_counts_status_check",
      sql`${table.status} IN ('completed', 'cancelled')`,
    ),
  }),
);

export type FoodServiceInventoryCount = InferSelectModel<
  typeof foodServiceInventoryCount
>;

export const foodServiceInventoryCountLine = pgTable(
  "food_service_inventory_count_lines",
  {
    countId: uuid("count_id")
      .notNull()
      .references(() => foodServiceInventoryCount.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    expectedPhysicalMicros: numeric("expected_physical_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    countedPhysicalMicros: numeric("counted_physical_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    varianceMicros: numeric("variance_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    movementId: uuid("movement_id").references(() => foodServiceStockMovement.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.countId, table.ingredientId] }),
    ingredientIdx: index(
      "food_service_inventory_count_lines_ingredient_id_idx",
    ).on(table.ingredientId),
    countedCheck: check(
      "food_service_inventory_count_lines_counted_check",
      sql`${table.countedPhysicalMicros} >= 0`,
    ),
    varianceCheck: check(
      "food_service_inventory_count_lines_variance_check",
      sql`${table.varianceMicros} = ${table.countedPhysicalMicros} - ${table.expectedPhysicalMicros} AND ((${table.varianceMicros} = 0 AND ${table.movementId} IS NULL) OR (${table.varianceMicros} <> 0 AND ${table.movementId} IS NOT NULL))`,
    ),
  }),
);

export type FoodServiceInventoryCountLine = InferSelectModel<
  typeof foodServiceInventoryCountLine
>;

export type FoodServiceRoutineSchedule =
  | { frequency: "daily" }
  | { frequency: "weekly"; weekdays: number[] };


export const foodServiceIngredientGroup = pgTable(
  "food_service_ingredient_groups",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => company.id),
    locationId: uuid("location_id").notNull().references(() => companyLocation.id),
    name: varchar("name", { length: 160 }).notNull(),
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    locationPositionIdx: index("food_service_ingredient_groups_location_position_idx").on(
      table.locationId,
      table.position,
    ),
    positionCheck: check(
      "food_service_ingredient_groups_position_check",
      sql`${table.position} >= 0`,
    ),
  }),
);

export const foodServiceIngredientGroupItem = pgTable(
  "food_service_ingredient_group_items",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => foodServiceIngredientGroup.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    position: integer("position").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.groupId, table.ingredientId] }),
    groupPositionUnique: uniqueIndex(
      "food_service_ingredient_group_items_position_unique",
    ).on(table.groupId, table.position),
    positionCheck: check(
      "food_service_ingredient_group_items_position_check",
      sql`${table.position} >= 0`,
    ),
  }),
);

export const foodServiceInventoryCountModel = pgTable(
  "food_service_inventory_count_models",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => company.id),
    locationId: uuid("location_id").notNull().references(() => companyLocation.id),
    name: varchar("name", { length: 160 }).notNull(),
    schedule: jsonb("schedule")
      .$type<FoodServiceRoutineSchedule>()
      .notNull()
      .default(sql`'{"frequency":"daily"}'::jsonb`),
    dueTime: varchar("due_time", { length: 5 }),
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    active: boolean("active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    locationNameUnique: uniqueIndex(
      "food_service_inventory_count_models_location_name_unique",
    ).on(table.locationId, sql`lower(${table.name})`),
    locationActiveIdx: index(
      "food_service_inventory_count_models_location_active_idx",
    ).on(table.locationId, table.active),
    dueTimeCheck: check(
      "food_service_inventory_count_models_due_time_check",
      sql`${table.dueTime} IS NULL OR ${table.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  }),
);

export const foodServiceInventoryCountModelGroup = pgTable(
  "food_service_inventory_count_model_groups",
  {
    modelId: uuid("model_id")
      .notNull()
      .references(() => foodServiceInventoryCountModel.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => foodServiceIngredientGroup.id),
    position: integer("position").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.modelId, table.groupId] }),
    modelPositionUnique: uniqueIndex(
      "food_service_inventory_count_model_groups_position_unique",
    ).on(table.modelId, table.position),
    positionCheck: check(
      "food_service_inventory_count_model_groups_position_check",
      sql`${table.position} >= 0`,
    ),
  }),
);

export const foodServiceInventoryCountDraft = pgTable(
  "food_service_inventory_count_drafts",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => company.id),
    locationId: uuid("location_id").notNull().references(() => companyLocation.id),
    modelId: uuid("model_id")
      .notNull()
      .references(() => foodServiceInventoryCountModel.id),
    operationalDate: date("operational_date").notNull(),
    status: varchar("status", {
      enum: ["in_progress", "submitted", "cancelled"],
    }).notNull().default("in_progress"),
    revision: integer("revision").notNull().default(0),
    finalCountId: uuid("final_count_id").references(() => foodServiceInventoryCount.id),
    startedByUserId: uuid("started_by_user_id").notNull().references(() => user.id),
    submittedByUserId: uuid("submitted_by_user_id").references(() => user.id),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    submittedAt: timestamp("submitted_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    modelDateUnique: uniqueIndex(
      "food_service_inventory_count_drafts_model_date_unique",
    ).on(table.modelId, table.operationalDate),
    locationDateIdx: index(
      "food_service_inventory_count_drafts_location_date_idx",
    ).on(table.locationId, table.operationalDate, table.status),
    lifecycleCheck: check(
      "food_service_inventory_count_drafts_lifecycle_check",
      sql`(${table.status} = 'in_progress' AND ${table.finalCountId} IS NULL AND ${table.submittedAt} IS NULL AND ${table.submittedByUserId} IS NULL) OR (${table.status} = 'submitted' AND ${table.finalCountId} IS NOT NULL AND ${table.submittedAt} IS NOT NULL AND ${table.submittedByUserId} IS NOT NULL) OR (${table.status} = 'cancelled' AND ${table.finalCountId} IS NULL)`,
    ),
  }),
);

export const foodServiceInventoryCountDraftLine = pgTable(
  "food_service_inventory_count_draft_lines",
  {
    draftId: uuid("draft_id")
      .notNull()
      .references(() => foodServiceInventoryCountDraft.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => foodServiceIngredientGroup.id),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => foodServiceIngredient.id),
    countedPhysicalMicros: numeric("counted_physical_micros", {
      precision: 24,
      scale: 0,
    }).notNull(),
    updatedByUserId: uuid("updated_by_user_id").notNull().references(() => user.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.draftId, table.groupId, table.ingredientId],
    }),
    countedCheck: check(
      "food_service_inventory_count_draft_lines_counted_check",
      sql`${table.countedPhysicalMicros} >= 0`,
    ),
  }),
);


export const foodServiceOperationalChecklist = pgTable(
  "food_service_operational_checklists",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    name: varchar("name", { length: 160 }).notNull(),
    schedule: jsonb("schedule")
      .$type<FoodServiceRoutineSchedule>()
      .notNull()
      .default(sql`'{"frequency":"daily"}'::jsonb`),
    dueTime: varchar("due_time", { length: 5 }),
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    active: boolean("active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    locationNameUnique: uniqueIndex(
      "food_service_operational_checklists_location_name_unique",
    ).on(table.locationId, sql`lower(${table.name})`),
    locationActiveIdx: index(
      "food_service_operational_checklists_location_active_idx",
    ).on(table.locationId, table.active),
    dueTimeCheck: check(
      "food_service_operational_checklists_due_time_check",
      sql`${table.dueTime} IS NULL OR ${table.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  }),
);

export type FoodServiceOperationalChecklist = InferSelectModel<
  typeof foodServiceOperationalChecklist
>;

export const foodServiceOperationalChecklistItem = pgTable(
  "food_service_operational_checklist_items",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => foodServiceOperationalChecklist.id, {
        onDelete: "cascade",
      }),
    label: varchar("label", { length: 240 }).notNull(),
    position: integer("position").notNull(),
    photoRequired: boolean("photo_required").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    checklistPositionUnique: uniqueIndex(
      "food_service_operational_checklist_items_position_unique",
    ).on(table.checklistId, table.position),
    positionCheck: check(
      "food_service_operational_checklist_items_position_check",
      sql`${table.position} >= 0`,
    ),
  }),
);

export const foodServiceOperationalChecklistRun = pgTable(
  "food_service_operational_checklist_runs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => companyLocation.id),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => foodServiceOperationalChecklist.id),
    operationalDate: date("operational_date").notNull(),
    status: varchar("status", {
      enum: ["in_progress", "completed", "partial"],
    })
      .notNull()
      .default("in_progress"),
    notes: text("notes"),
    revision: integer("revision").notNull().default(0),
    assignedUserId: uuid("assigned_user_id").references(() => user.id),
    completedByUserId: uuid("completed_by_user_id").references(() => user.id),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    checklistDateUnique: uniqueIndex(
      "food_service_operational_checklist_runs_checklist_date_unique",
    ).on(table.checklistId, table.operationalDate),
    locationDateIdx: index(
      "food_service_operational_checklist_runs_location_date_idx",
    ).on(table.locationId, table.operationalDate, table.status),
    lifecycleCheck: check(
      "food_service_operational_checklist_runs_lifecycle_check",
      sql`(${table.status} = 'in_progress' AND ${table.completedAt} IS NULL AND ${table.completedByUserId} IS NULL) OR (${table.status} IN ('completed', 'partial') AND ${table.completedAt} IS NOT NULL AND ${table.completedByUserId} IS NOT NULL)`,
    ),
    revisionCheck: check(
      "food_service_operational_checklist_runs_revision_check",
      sql`${table.revision} >= 0`,
    ),
  }),
);

export const foodServiceOperationalChecklistRunItem = pgTable(
  "food_service_operational_checklist_run_items",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => foodServiceOperationalChecklistRun.id, {
        onDelete: "cascade",
      }),
    checklistItemId: uuid("checklist_item_id")
      .notNull()
      .references(() => foodServiceOperationalChecklistItem.id),
    status: varchar("status", {
      enum: ["pending", "completed", "not_done"],
    })
      .notNull()
      .default("pending"),
    note: text("note"),
    evidenceUrl: text("evidence_url"),
    updatedByUserId: uuid("updated_by_user_id")
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.checklistItemId] }),
    statusCheck: check(
      "food_service_operational_checklist_run_items_status_check",
      sql`${table.status} IN ('pending', 'completed', 'not_done')`,
    ),
  }),
);


export const foodServiceIfoodConnection = pgTable(
  "food_service_ifood_connections",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    merchantId: varchar("merchant_id", { length: 200 }).notNull(),
    merchantName: varchar("merchant_name", { length: 160 }),
    catalogId: varchar("catalog_id", { length: 200 }),
    status: varchar("status", {
      enum: ["connected", "revoked"],
    })
      .notNull()
      .default("connected"),
    connectedAt: timestamp("connected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companyUnique: uniqueIndex("food_service_ifood_connections_company_unique").on(
      table.companyId,
    ),
    merchantUnique: uniqueIndex(
      "food_service_ifood_connections_merchant_unique",
    )
      .on(table.merchantId)
      .where(sql`${table.status} = 'connected'`),
    statusCheck: check(
      "food_service_ifood_connections_status_check",
      sql`${table.status} IN ('connected', 'revoked')`,
    ),
  }),
);

export type FoodServiceIfoodConnection = InferSelectModel<
  typeof foodServiceIfoodConnection
>;

export const foodServiceMenuImportJob = pgTable(
  "food_service_menu_import_jobs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    locationId: uuid("location_id").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    normalizedUrl: text("normalized_url").notNull(),
    provider: varchar("provider", {
      enum: ["anota_ai", "brendi", "ifood", "generic_web"],
    }).notNull(),
    adapterVersion: varchar("adapter_version", { length: 80 }).notNull(),
    status: varchar("status", {
      enum: [
        "queued", "extracting", "normalizing", "analyzing", "needs_review",
        "ready", "publishing", "published", "failed", "cancelled",
      ],
    }).notNull().default("queued"),
    idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    sourceFingerprint: varchar("source_fingerprint", { length: 64 }),
    sourceDocument: jsonb("source_document").$type<Record<string, unknown>>(),
    workflowRunId: varchar("workflow_run_id", { length: 255 }),
    attemptCount: integer("attempt_count").notNull().default(0),
    counts: jsonb("counts")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorCode: varchar("error_code", { length: 120 }),
    errorDetail: text("error_detail"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    idCompanyMenuUnique: unique(
      "food_service_menu_import_jobs_id_company_menu_unique",
    ).on(table.id, table.companyId, table.menuId),
    companyIdempotencyUnique: uniqueIndex(
      "food_service_menu_import_jobs_company_idempotency_unique",
    ).on(table.companyId, table.idempotencyKey),
    companyStatusIdx: index(
      "food_service_menu_import_jobs_company_status_idx",
    ).on(table.companyId, table.status, table.createdAt),
    menuCompanyFk: foreignKey({
      columns: [table.menuId, table.companyId],
      foreignColumns: [foodServiceMenu.id, foodServiceMenu.companyId],
      name: "food_service_menu_import_jobs_menu_company_fk",
    }).onDelete("cascade"),
    locationCompanyFk: foreignKey({
      columns: [table.locationId, table.companyId],
      foreignColumns: [companyLocation.id, companyLocation.companyId],
      name: "food_service_menu_import_jobs_location_company_fk",
    }).onDelete("cascade"),
    providerCheck: check(
      "food_service_menu_import_jobs_provider_check",
      sql`${table.provider} IN ('anota_ai', 'brendi', 'ifood', 'generic_web')`,
    ),
    statusCheck: check(
      "food_service_menu_import_jobs_status_check",
      sql`${table.status} IN ('queued', 'extracting', 'normalizing', 'analyzing', 'needs_review', 'ready', 'publishing', 'published', 'failed', 'cancelled')`,
    ),
    terminalTimestampCheck: check(
      "food_service_menu_import_jobs_terminal_timestamp_check",
      sql`(${table.status} IN ('published', 'failed', 'cancelled') AND ${table.completedAt} IS NOT NULL) OR (${table.status} NOT IN ('published', 'failed', 'cancelled') AND ${table.completedAt} IS NULL)`,
    ),
    attemptCountCheck: check(
      "food_service_menu_import_jobs_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
  }),
);

export type FoodServiceMenuImportJob = InferSelectModel<
  typeof foodServiceMenuImportJob
>;

export const foodServiceMenuImportDraft = pgTable(
  "food_service_menu_import_drafts",
  {
    jobId: uuid("job_id").primaryKey().notNull(),
    companyId: uuid("company_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    revision: integer("revision").notNull().default(1),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    resolvedMappings: jsonb("resolved_mappings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    documentFingerprint: varchar("document_fingerprint", { length: 64 }).notNull(),
    validationSummary: jsonb("validation_summary")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    jobCompanyMenuUnique: unique(
      "food_service_menu_import_drafts_job_company_menu_unique",
    ).on(table.jobId, table.companyId, table.menuId),
    jobCompanyMenuFk: foreignKey({
      columns: [table.jobId, table.companyId, table.menuId],
      foreignColumns: [
        foodServiceMenuImportJob.id,
        foodServiceMenuImportJob.companyId,
        foodServiceMenuImportJob.menuId,
      ],
      name: "food_service_menu_import_drafts_job_company_menu_fk",
    }).onDelete("cascade"),
    revisionCheck: check(
      "food_service_menu_import_drafts_revision_check",
      sql`${table.revision} > 0 AND ${table.schemaVersion} > 0`,
    ),
  }),
);

export type FoodServiceMenuImportDraft = InferSelectModel<
  typeof foodServiceMenuImportDraft
>;

export const foodServiceMenuImportIssue = pgTable(
  "food_service_menu_import_issues",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    companyId: uuid("company_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    fieldPath: text("field_path").notNull(),
    code: varchar("code", { length: 120 }).notNull(),
    severity: varchar("severity", { enum: ["blocking", "warning"] }).notNull(),
    message: text("message").notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    status: varchar("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    resolution: text("resolution"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => user.id),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    draftCompanyMenuFk: foreignKey({
      columns: [table.jobId, table.companyId, table.menuId],
      foreignColumns: [
        foodServiceMenuImportDraft.jobId,
        foodServiceMenuImportDraft.companyId,
        foodServiceMenuImportDraft.menuId,
      ],
      name: "food_service_menu_import_issues_draft_company_menu_fk",
    }).onDelete("cascade"),
    jobStatusIdx: index("food_service_menu_import_issues_job_status_idx").on(
      table.jobId,
      table.status,
      table.severity,
    ),
    severityCheck: check(
      "food_service_menu_import_issues_severity_check",
      sql`${table.severity} IN ('blocking', 'warning')`,
    ),
    statusCheck: check(
      "food_service_menu_import_issues_status_check",
      sql`${table.status} IN ('open', 'resolved')`,
    ),
    confidenceCheck: check(
      "food_service_menu_import_issues_confidence_check",
      sql`${table.confidenceBasisPoints} BETWEEN 0 AND 10000`,
    ),
    resolutionCheck: check(
      "food_service_menu_import_issues_resolution_check",
      sql`(${table.status} = 'open' AND ${table.resolution} IS NULL AND ${table.resolvedByUserId} IS NULL AND ${table.resolvedAt} IS NULL) OR (${table.status} = 'resolved' AND ${table.resolution} IS NOT NULL AND ${table.resolvedByUserId} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`,
    ),
  }),
);

export type FoodServiceMenuImportIssue = InferSelectModel<
  typeof foodServiceMenuImportIssue
>;

export const foodServiceMenuImportBlob = pgTable(
  "food_service_menu_import_blobs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    jobId: uuid("job_id").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    generationId: uuid("generation_id").notNull(),
    blobUrl: text("blob_url"),
    blobEtag: varchar("blob_etag", { length: 256 }),
    pathname: text("pathname").notNull(),
    mimeType: varchar("mime_type", {
      enum: ["image/jpeg", "image/png", "image/webp"],
    }).notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    attemptToken: uuid("attempt_token").notNull(),
    status: varchar("status", {
      enum: ["uploading", "temporary", "referenced", "deleting", "deleted"],
    })
      .notNull()
      .default("uploading"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    referencedAt: timestamp("referenced_at"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    scopeHashUnique: uniqueIndex(
      "food_service_menu_import_blobs_scope_hash_unique",
    ).on(table.companyId, table.menuId, table.contentHash),
    blobUrlUnique: uniqueIndex(
      "food_service_menu_import_blobs_blob_url_unique",
    ).on(table.blobUrl),
    pathnameUnique: uniqueIndex(
      "food_service_menu_import_blobs_pathname_unique",
    ).on(table.pathname),
    cleanupIndex: index("food_service_menu_import_blobs_cleanup_idx").on(
      table.status,
      table.updatedAt,
    ),
    menuCompanyFk: foreignKey({
      columns: [table.menuId, table.companyId],
      foreignColumns: [foodServiceMenu.id, foodServiceMenu.companyId],
      name: "food_service_menu_import_blobs_menu_company_fk",
    }).onDelete("cascade"),
    jobCompanyMenuFk: foreignKey({
      columns: [table.jobId, table.companyId, table.menuId],
      foreignColumns: [
        foodServiceMenuImportJob.id,
        foodServiceMenuImportJob.companyId,
        foodServiceMenuImportJob.menuId,
      ],
      name: "food_service_menu_import_blobs_job_company_menu_fk",
    }).onDelete("cascade"),
    hashCheck: check(
      "food_service_menu_import_blobs_hash_check",
      sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`,
    ),
    boundsCheck: check(
      "food_service_menu_import_blobs_bounds_check",
      sql`${table.byteSize} BETWEEN 1 AND 8388608 AND ${table.width} BETWEEN 1 AND 8192 AND ${table.height} BETWEEN 1 AND 8192 AND ${table.width}::bigint * ${table.height}::bigint <= 40000000`,
    ),
    statusCheck: check(
      "food_service_menu_import_blobs_status_check",
      sql`${table.status} IN ('uploading', 'temporary', 'referenced', 'deleting', 'deleted')`,
    ),
    mimeCheck: check(
      "food_service_menu_import_blobs_mime_check",
      sql`${table.mimeType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    lifecycleCheck: check(
      "food_service_menu_import_blobs_lifecycle_check",
      sql`(${table.status} = 'uploading' AND ${table.blobUrl} IS NULL AND ${table.blobEtag} IS NULL AND ${table.leaseExpiresAt} IS NOT NULL AND ${table.referencedAt} IS NULL AND ${table.deletedAt} IS NULL) OR (${table.status} = 'temporary' AND ${table.blobUrl} IS NOT NULL AND ${table.blobEtag} IS NOT NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.referencedAt} IS NULL AND ${table.deletedAt} IS NULL) OR (${table.status} = 'referenced' AND ${table.blobUrl} IS NOT NULL AND ${table.blobEtag} IS NOT NULL AND ${table.pathname} IS NOT NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.referencedAt} IS NOT NULL AND ${table.deletedAt} IS NULL) OR (${table.status} = 'deleting' AND ${table.blobUrl} IS NOT NULL AND ${table.blobEtag} IS NOT NULL AND ${table.referencedAt} IS NULL AND ${table.deletedAt} IS NULL) OR (${table.status} = 'deleted' AND ${table.blobUrl} IS NULL AND ${table.blobEtag} IS NULL AND ${table.leaseExpiresAt} IS NULL AND ${table.referencedAt} IS NULL AND ${table.deletedAt} IS NOT NULL)`,
    ),
  }),
);

export type FoodServiceMenuImportBlob = InferSelectModel<
  typeof foodServiceMenuImportBlob
>;

export const foodServiceMenuCatalogVersion = pgTable(
  "food_service_menu_catalog_versions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    sequence: integer("sequence").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    sourceRefs: jsonb("source_refs")
      .$type<
        Array<{
          provider: string;
          entityType: string;
          externalId: string;
          localEntityId: string;
        }>
      >()
      .notNull()
      .default([]),
    warningSummary: jsonb("warning_summary")
      .$type<{ imageFailures: { count: number; acknowledged: boolean; byCode: Record<string, number> } }>()
      .notNull()
      .default(sql`'{"imageFailures":{"count":0,"acknowledged":false,"byCode":{}}}'::jsonb`),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    origin: varchar("origin", { enum: ["imported", "restored"] }).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => user.id),
    sourceJobId: uuid("source_job_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    menuSequenceUnique: unique(
      "food_service_menu_catalog_versions_menu_sequence_unique",
    ).on(table.menuId, table.sequence),
    menuCompanyFk: foreignKey({
      columns: [table.menuId, table.companyId],
      foreignColumns: [foodServiceMenu.id, foodServiceMenu.companyId],
      name: "food_service_menu_catalog_versions_menu_company_fk",
    }).onDelete("cascade"),
    sourceJobCompanyMenuFk: foreignKey({
      columns: [table.sourceJobId, table.companyId, table.menuId],
      foreignColumns: [
        foodServiceMenuImportJob.id,
        foodServiceMenuImportJob.companyId,
        foodServiceMenuImportJob.menuId,
      ],
      name: "food_service_menu_catalog_versions_source_job_company_menu_fk",
    }),
    originCheck: check(
      "food_service_menu_catalog_versions_origin_check",
      sql`${table.origin} IN ('imported', 'restored')`,
    ),
    sequenceCheck: check(
      "food_service_menu_catalog_versions_sequence_check",
      sql`${table.sequence} > 0`,
    ),
  }),
);

export type FoodServiceMenuCatalogVersion = InferSelectModel<
  typeof foodServiceMenuCatalogVersion
>;

export const foodServiceMenuCatalogOperation = pgTable(
  "food_service_menu_catalog_operations",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    operationKey: varchar("operation_key", { length: 200 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    origin: varchar("origin", { enum: ["imported", "restored"] }).notNull(),
    versionId: uuid("version_id").notNull(),
    versionSequence: integer("version_sequence").notNull(),
    versionFingerprint: varchar("version_fingerprint", { length: 64 }).notNull(),
    sourceJobId: uuid("source_job_id"),
    sourceVersionId: uuid("source_version_id"),
    failedImageCount: integer("failed_image_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    operationKeyUnique: uniqueIndex(
      "food_service_menu_catalog_operations_operation_key_unique",
    ).on(table.companyId, table.menuId, table.operationKey),
    menuCompanyFk: foreignKey({
      columns: [table.menuId, table.companyId],
      foreignColumns: [foodServiceMenu.id, foodServiceMenu.companyId],
      name: "food_service_menu_catalog_operations_menu_company_fk",
    }).onDelete("cascade"),
    originCheck: check(
      "food_service_menu_catalog_operations_origin_check",
      sql`${table.origin} IN ('imported', 'restored')`,
    ),
    sequenceCheck: check(
      "food_service_menu_catalog_operations_sequence_check",
      sql`${table.versionSequence} > 0 AND ${table.failedImageCount} >= 0`,
    ),
  }),
);

export type FoodServiceMenuCatalogOperation = InferSelectModel<
  typeof foodServiceMenuCatalogOperation
>;

export const foodServiceMenuSourceRef = pgTable(
  "food_service_menu_source_refs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    menuId: uuid("menu_id").notNull(),
    provider: varchar("provider", {
      enum: ["anota_ai", "brendi", "ifood", "generic_web"],
    }).notNull(),
    entityType: varchar("entity_type", {
      enum: ["category", "item", "option_group", "option"],
    }).notNull(),
    externalId: varchar("external_id", { length: 200 }).notNull(),
    localEntityType: varchar("local_entity_type", {
      enum: ["category", "item", "option_group", "option"],
    }).notNull(),
    localEntityId: uuid("local_entity_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    externalIdentityUnique: uniqueIndex(
      "food_service_menu_source_refs_external_identity_unique",
    ).on(
      table.companyId,
      table.menuId,
      table.provider,
      table.entityType,
      table.externalId,
    ),
    localIdentityUnique: uniqueIndex(
      "food_service_menu_source_refs_local_identity_unique",
    ).on(
      table.companyId,
      table.menuId,
      table.provider,
      table.localEntityType,
      table.localEntityId,
    ),
    menuCompanyFk: foreignKey({
      columns: [table.menuId, table.companyId],
      foreignColumns: [foodServiceMenu.id, foodServiceMenu.companyId],
      name: "food_service_menu_source_refs_menu_company_fk",
    }).onDelete("cascade"),
    providerCheck: check(
      "food_service_menu_source_refs_provider_check",
      sql`${table.provider} IN ('anota_ai', 'brendi', 'ifood', 'generic_web')`,
    ),
    entityTypeCheck: check(
      "food_service_menu_source_refs_entity_type_check",
      sql`${table.entityType} IN ('category', 'item', 'option_group', 'option') AND ${table.localEntityType} IN ('category', 'item', 'option_group', 'option')`,
    ),
  }),
);

export type FoodServiceMenuSourceRef = InferSelectModel<
  typeof foodServiceMenuSourceRef
>;

// ===== END food_service_* =====

export const radarSearchConfigurations = pgTable("radar_search_configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  niche: text("niche"),
  subNiche: text("sub_niche"),
  keywords: jsonb("keywords").$type<string[]>(),
  hashtags: jsonb("hashtags").$type<string[]>(),
  profiles: jsonb("profiles").$type<string[]>(),
  platforms: jsonb("platforms").$type<string[]>(),
  formats: jsonb("formats").$type<string[]>(),
  country: text("country"),
  state: text("state"),
  city: text("city"),
  frequency: text("frequency"),
  maxResults: integer("max_results"),
  minScore: integer("min_score"),
  requiresApproval: boolean("requires_approval").default(true).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdBy: uuid("created_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const radarCollectionRuns = pgTable("radar_collection_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id").references(() => radarSearchConfigurations.id, { onDelete: "cascade" }),
  origin: text("origin").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  itemsFound: integer("items_found").default(0).notNull(),
  itemsNew: integer("items_new").default(0).notNull(),
  itemsUpdated: integer("items_updated").default(0).notNull(),
  itemsDuplicated: integer("items_duplicated").default(0).notNull(),
  errorsCount: integer("errors_count").default(0).notNull(),
  creditsConsumed: integer("credits_consumed").default(0).notNull(),
  errorMessage: text("error_message"),
  executedBy: uuid("executed_by").references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const radarContents = pgTable("radar_contents", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull(),
  platform: text("platform").notNull(),
  format: text("format"),
  profileHandle: text("profile_handle"),
  caption: text("caption"),
  thumbnailUrl: text("thumbnail_url"),
  previewUrl: text("preview_url"),
  originalUrl: text("original_url"),
  currentMetrics: jsonb("current_metrics"),
  trendScore: numeric("trend_score"),
  classification: text("classification"),
  trendStatus: text("trend_status"),
  niche: text("niche"),
  subNiche: text("sub_niche"),
  location: text("location"),
  publishedAt: timestamp("published_at"),
  firstDetectedAt: timestamp("first_detected_at").defaultNow().notNull(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
  publicationStatus: text("publication_status").default('pending').notNull(),
  isPinned: boolean("is_pinned").default(false).notNull(),
  adminNotes: text("admin_notes"),
}, (table) => ({
  unqPlatformExternalId: uniqueIndex("radar_content_platform_external_id_idx").on(table.platform, table.externalId),
}));

export const radarContentSnapshots = pgTable("radar_content_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  contentId: uuid("content_id").references(() => radarContents.id, { onDelete: "cascade" }).notNull(),
  collectedAt: timestamp("collected_at").defaultNow().notNull(),
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  saves: integer("saves"),
  profileFollowers: integer("profile_followers"),
});
