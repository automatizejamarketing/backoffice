import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  integer,
  json,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AppUsage } from "../usage";
import type { Layer, PostStatus } from "../types";

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
});

export type User = InferSelectModel<typeof user>;

export const blobUpload = pgTable("blob_uploads", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  blobUrl: text("blob_url").notNull(),
  pathname: text("pathname"),
  contentType: text("content_type"),
  source: varchar("source", { length: 50 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type BlobUpload = InferSelectModel<typeof blobUpload>;

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

export const chat = pgTable("chats", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("created_at").notNull(),
  title: text("title").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
  lastContext: jsonb("last_context").$type<AppUsage | null>(),
});

export type Chat = InferSelectModel<typeof chat>;

export const message = pgTable("messages", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export type DBMessage = InferSelectModel<typeof message>;

export const vote = pgTable(
  "votes",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chat.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => message.id),
    isUpvoted: boolean("is_upvoted").notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.chatId, table.messageId] }),
    };
  }
);

export type Vote = InferSelectModel<typeof vote>;

export const document = pgTable(
  "documents",
  {
    id: uuid("id").notNull().defaultRandom(),
    createdAt: timestamp("created_at").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] })
      .notNull()
      .default("text"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  }
);

export type Document = InferSelectModel<typeof document>;

export const suggestion = pgTable(
  "suggestions",
  {
    id: uuid("id").notNull().defaultRandom(),
    documentId: uuid("document_id").notNull(),
    documentCreatedAt: timestamp("document_created_at").notNull(),
    originalText: text("original_text").notNull(),
    suggestedText: text("suggested_text").notNull(),
    description: text("description"),
    isResolved: boolean("is_resolved").notNull().default(false),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }),
  })
);

export type Suggestion = InferSelectModel<typeof suggestion>;

export const stream = pgTable(
  "streams",
  {
    id: uuid("id").notNull().defaultRandom(),
    chatId: uuid("chat_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id],
    }),
  })
);

export type Stream = InferSelectModel<typeof stream>;

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Company = InferSelectModel<typeof company>;

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
  })
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
      "instagram_accounts_user_id_account_id_unique"
    ).on(table.userId, table.accountId),
  })
);

export type InstagramAccount = InferSelectModel<typeof instagramAccount>;

// Meta Business Account table for storing Facebook user connections (for Marketing API)
export const metaBusinessAccount = pgTable(
  "meta_business_accounts",
  {
    id: text("id").primaryKey().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    facebookUserId: text("facebook_user_id").notNull(),
    name: text("name"),
    pictureUrl: text("picture_url"),
    accessToken: text("access_token").notNull(),
    tokenExpiresAt: timestamp("token_expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    uniqueUserFacebookAccount: unique(
      "meta_business_accounts_user_id_facebook_user_id_unique"
    ).on(table.userId, table.facebookUserId),
  })
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

export type CampaignBudgetModeData = "ABO" | "CBO";

export type CampaignAdSetBudgetChangeData = {
  adsetId: string;
  adsetName?: string;
  previousDailyBudget?: string | null;
  newDailyBudget: string;
};

// AdSet Edit Logs - tracking manual changes made by backoffice admins
// backoffice_user_email: Google OAuth admins are not in users table; store email like backoffice_audit_logs
export const adsetEditLog = pgTable("adset_edit_logs", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  backofficeUserEmail: varchar("backoffice_user_email", { length: 100 }).notNull(),
  targetUserId: uuid("target_user_id")
    .notNull()
    .references(() => user.id),
  adsetId: text("adset_id").notNull(),
  accountId: text("account_id").notNull(),
  campaignId: text("campaign_id"),
  adsetName: text("adset_name"),
  previousDailyBudget: numeric("previous_daily_budget"),
  newDailyBudget: numeric("new_daily_budget"),
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
  backofficeUserEmail: varchar("backoffice_user_email", { length: 100 }).notNull(),
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
  adsetBudgetChanges:
    jsonb("adset_budget_changes").$type<CampaignAdSetBudgetChangeData[]>(),
  note: text("note").notNull(),
  appliedToMeta: boolean("applied_to_meta").notNull().default(false),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CampaignEditLog = InferSelectModel<typeof campaignEditLog>;

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
      () => generatedImage.id
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
      "scheduled_posts_media_container_id_unique"
    ).on(table.mediaContainerId),
  })
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

  // Related chat (for AI conversation context)
  chatId: uuid("chat_id").references(() => chat.id),

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
  })
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
  sourceUserGeneratedImageId: uuid("source_user_generated_image_id")
    .references(() => generatedImage.id),
  sourceBackofficePostId: uuid("source_backoffice_post_id"),
  prompt: text("prompt").notNull(),
  generatedImageId: uuid("generated_image_id").references(
    () => generatedImage.id
  ),
  captionTextId: uuid("caption_text_id").references(() => aiGeneratedText.id),
  referenceImageUrls: jsonb("reference_image_urls").$type<string[]>().default([]),
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
// Stripe Subscription Management
// =============================================

// Plan type enum - compound: {period}_{tier}
export const PLAN_TYPE_VALUES = [
  "monthly_starter", "monthly_pro", "monthly_premium",
  "quarterly_starter", "quarterly_pro", "quarterly_premium",
  "semiannual_starter", "semiannual_pro", "semiannual_premium",
  "annual_starter", "annual_pro", "annual_premium",
] as const;

export type PlanType = (typeof PLAN_TYPE_VALUES)[number];

// Subscription status enum (mirrors Stripe)
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "trialing";

// Subscriptions table - tracks Stripe subscription records
export const subscription = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    stripeSubscriptionId: varchar("stripe_subscription_id", {
      length: 255,
    }).notNull(),
    stripePriceId: varchar("stripe_price_id", { length: 255 }).notNull(),
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
    uniqueStripeSubscriptionId: unique(
      "subscriptions_stripe_subscription_id_unique"
    ).on(table.stripeSubscriptionId),
  })
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
    amount: integer("amount").notNull(),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueStripeInvoiceId: unique("payments_stripe_invoice_id_unique").on(
      table.stripeInvoiceId
    ),
  })
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
      "processed_webhook_events_stripe_event_id_unique"
    ).on(table.stripeEventId),
  })
);

export type ProcessedWebhookEvent = InferSelectModel<
  typeof processedWebhookEvent
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
