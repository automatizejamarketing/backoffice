import type { MetaCtx } from "@/lib/meta-business/insights";
import { resolveAdvertisingIdentity } from "@/lib/meta-business/get-instagram-connected-page";
import { localIssue, type CreateIssue } from "../creation/types";
import type { PlanAnswers } from "./build-tree";

export type AdvertisingCampaignContext = MetaCtx & {
  tokenKind?: "user" | "bisu";
  bisuAppScopedId?: string | null;
  /** Check application enabled assets after resolving the live pair. */
  authorizeAdvertisingIdentity?: (identity: { pageId: string; instagramUserId: string }) => Promise<void>;
};

/** Run before copies or uploads; copied ads retain their original actors. */
export async function resolveNewMediaIdentity(args: {
  ctx: AdvertisingCampaignContext;
  answers: PlanAnswers;
  moldIdentity: { pageId?: string; instagramUserId?: string };
  fixedPageId?: string;
}): Promise<{ ok: true; answers: PlanAnswers } | { ok: false; issues: CreateIssue[] }> {
  const { ctx, answers, moldIdentity, fixedPageId } = args;
  const requestedPage = answers.pageId?.trim();
  if (fixedPageId && requestedPage && requestedPage !== fixedPageId) {
    return { ok: false, issues: [localIssue("ad", "ADSET_PAGE_MISMATCH", "As mídias novas precisam usar a Página do conjunto vencedor.", "Selecione um Instagram autorizado para a Página deste conjunto.", ["pageId"])] };
  }
  const pageId = requestedPage || fixedPageId || moldIdentity.pageId;
  const instagramUserId = answers.instagramUserId?.trim() || (pageId === moldIdentity.pageId ? moldIdentity.instagramUserId : undefined);
  const resolved = pageId ? await resolveAdvertisingIdentity(ctx.accessToken, {
    adAccountId: ctx.adAccountId, pageId, instagramBusinessAccountId: instagramUserId,
    tokenKind: ctx.tokenKind, bisuAppScopedId: ctx.bisuAppScopedId,
  }) : null;
  if (!resolved) {
    return { ok: false, issues: [localIssue("ad", "ADVERTISING_IDENTITY_UNAVAILABLE", "A Página e o Instagram das mídias novas não estão disponíveis nesta conta de anúncios.", "Selecione uma combinação autorizada de Página e Instagram.", ["pageId", "instagramUserId"])] };
  }
  const identity = { pageId: resolved.page.id, instagramUserId: resolved.instagramBusinessAccountId };
  await ctx.authorizeAdvertisingIdentity?.(identity);
  return { ok: true, answers: { ...answers, ...identity } };
}
