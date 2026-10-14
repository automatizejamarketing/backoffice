import "server-only";
import { gateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { sql } from "drizzle-orm";
import { gatewayProviderOptions, GATEWAY_TAG } from "@/lib/ai/gateway-tags";
import { canAccessMarketingUser, hasBackofficePermission, type BackofficeActor } from "@/lib/auth/rbac-core";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getDossierAds } from "./journey-data";
import {
  buildOfferPrompt,
  buildOfferPromptInput,
  extractCreativeCopy,
  parseOfferResponse,
  selectOfferAds,
  type CreativeCopy,
  type OfferCompany,
  type OfferMenuItem,
  type OfferSuggestion,
  type OfferSuggestionResult,
} from "./offer-suggestion";
import { readWorkspaceState } from "./state";

/**
 * "Sugerir oferta/combo" (tela e MCP): junta empresa, criativos fracos, os
 * melhores como contraste e o cardápio (se houver), e pede ao modelo 3 opções.
 * Nada é salvo: o gestor escolhe uma e ela vira mensagem da Mat.
 */

const MODEL = "anthropic/claude-sonnet-5.5";
const OFFER_RATE_LIMIT = { limit: 20, windowSeconds: 3600 };
const MENU_ROWS = 60;

export class OfferSuggestionError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 429 | 502 = 502,
  ) {
    super(message);
  }
}

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  return Array.from((await db.execute(query)) as unknown as Row[]);
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

async function loadCompany(userId: string): Promise<{ id: string; company: OfferCompany } | null> {
  const [row] = await rows(sql`
    select c.id, c.name, c.description, c.niche, c.sub_niche, c.industry, c.target_audience, c.business_address
    from user_companies uc join companies c on c.id = uc.company_id
    where uc.user_id = ${userId}::uuid
    order by uc.created_at asc
    limit 1
  `);
  if (!row) return null;
  const address = row.business_address && typeof row.business_address === "object" ? (row.business_address as Record<string, unknown>) : null;
  return {
    id: String(row.id),
    company: {
      name: text(row.name),
      description: text(row.description),
      niche: text(row.niche),
      subNiche: text(row.sub_niche),
      industry: text(row.industry),
      targetAudience: text(row.target_audience),
      city: text(address?.city),
    },
  };
}

/** Texto do criativo atual de cada anúncio (`meta_tracking_creatives.spec`). */
async function loadCreativeCopy(userId: string, adIds: string[]): Promise<Map<string, CreativeCopy>> {
  if (adIds.length === 0) return new Map();
  const result = await rows(sql`
    select distinct on (v.entity_id) v.entity_id, cr.spec
    from meta_tracking_config_versions v
    join meta_tracking_creatives cr on cr.id = v.creative_id
    where v.user_id = ${userId}::uuid and v.entity_level = 'ad'
      and v.entity_id in (${sql.join(adIds.map((id) => sql`${id}`), sql`, `)})
    order by v.entity_id, (v.valid_to is null) desc, v.valid_from desc
  `);
  return new Map(result.map((row) => [String(row.entity_id), extractCreativeCopy(row.spec)]));
}

/** Itens ativos do cardápio da empresa (quase sempre vazio hoje). */
async function loadMenuItems(companyId: string): Promise<OfferMenuItem[]> {
  const result = await rows(sql`
    select i.name, i.description, i.base_price_centavos, i.featured, cat.name as category
    from food_service_items i
    join food_service_categories cat on cat.id = i.category_id
    join food_service_menus m on m.id = cat.menu_id
    where m.company_id = ${companyId}::uuid and i.active and cat.active
    order by i.featured desc, cat.position asc, i.position asc
    limit ${MENU_ROWS}
  `);
  return result.map((row) => ({
    name: String(row.name),
    description: text(row.description),
    category: text(row.category),
    priceCentavos: Number(row.base_price_centavos ?? 0),
    featured: Boolean(row.featured),
  }));
}

export async function suggestOffers(
  actor: BackofficeActor,
  input: { userId: string; adIds?: string[]; days?: number },
): Promise<OfferSuggestionResult> {
  if (!hasBackofficePermission(actor, "marketing:write")) throw new OfferSuggestionError("Seu cargo não pode pedir sugestões ao cliente.", 403);
  if (!canAccessMarketingUser(actor, input.userId)) throw new OfferSuggestionError("Este cliente não está na sua carteira.", 403);
  const days = Math.min(Math.max(input.days ?? 7, 1), 90);
  // Cada sugestão é uma chamada paga ao modelo.
  const limit = checkRateLimit(`consultant-offer-ai:${actor.email}`, OFFER_RATE_LIMIT);
  if (!limit.success) {
    throw new OfferSuggestionError(`Limite de ${OFFER_RATE_LIMIT.limit} sugestões por hora atingido. Tente em ${Math.ceil(limit.retryAfterSeconds / 60)} min.`, 429);
  }

  const [ads, store, companyRow] = await Promise.all([
    getDossierAds(input.userId, days),
    readWorkspaceState({ userIds: [input.userId] }),
    loadCompany(input.userId),
  ]);
  const { bad, best } = selectOfferAds({ ads, adIds: input.adIds, goal: store.goals[input.userId], days });
  const [copyByAd, menuItems] = await Promise.all([
    loadCreativeCopy(input.userId, [...bad, ...best].map((ad) => ad.adId)),
    companyRow ? loadMenuItems(companyRow.id).catch((error) => {
      console.warn("[consultant-workspace offer] cardápio indisponível", error);
      return [] as OfferMenuItem[];
    }) : Promise.resolve([] as OfferMenuItem[]),
  ]);
  const promptInput = buildOfferPromptInput({ days, company: companyRow?.company ?? null, bad, best, copyByAd, menuItems });
  const { system, prompt } = buildOfferPrompt(promptInput);

  let suggestions: OfferSuggestion[];
  try {
    const result = await generateText({
      model: gateway(MODEL),
      // O modelo raciocina antes de responder: folga para o JSON não sair cortado.
      maxOutputTokens: 4000,
      system,
      prompt,
      providerOptions: gatewayProviderOptions(GATEWAY_TAG.aiOfertaCombo),
    });
    suggestions = parseOfferResponse(result.text, promptInput.menu.hasPrices);
  } catch (error) {
    console.error("[consultant-workspace offer]", error);
    throw new OfferSuggestionError("A IA não conseguiu sugerir ofertas agora. Tente de novo em instantes.", 502);
  }

  return {
    suggestions,
    model: MODEL,
    basedOn: {
      badAds: promptInput.badAds.map((ad) => ({ adId: ad.adId, name: ad.name })),
      bestAds: promptInput.bestAds.map((ad) => ({ adId: ad.adId, name: ad.name })),
      menuItems: promptInput.menu.items.length,
      menuHasPrices: promptInput.menu.hasPrices,
    },
  };
}
