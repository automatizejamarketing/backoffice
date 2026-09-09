import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  AccountNotAccessibleError,
  assertCustomAudienceAccountAccess,
  listCustomAudiences,
  deleteCustomAudience,
  websiteSourceEvidence,
  reviewWebsiteAudience,
  confirmWebsiteAudience,
  reconcileWebsiteAudience,
  discoverWebsiteSources,
  websitePeriodEvidenceBySource,
  reviewLookalikeAudience,
  confirmLookalikeAudience,
  reconcileLookalikeAudience,
  previewAudienceMetadataUpdate,
  confirmAudienceMetadataUpdate,
  reconcileAudienceMetadataUpdate,
  type InstagramAudienceCriterion,
  INSTAGRAM_PERIOD_EVIDENCE,
  instagramSourceEvidence,
  reviewInstagramAudience,
  confirmInstagramAudience,
  reconcileInstagramAudience,
} from "@/lib/meta-business/marketing/audiences";
import { getAdvertisingIdentities } from "@/lib/meta-business/get-instagram-connected-page";
import { getAdAccountPixels } from "@/lib/meta-business/get-ad-account-pixels";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { customerFileDurableStore } from "@/lib/customer-file/postgres";
import { createPostgresAudienceCommandStore } from "@/lib/meta-business/marketing/audiences/command-store";
import {
  enterMetaMutationLog,
  updateMetaMutationContext,
} from "@/lib/observability/meta-log-context";

type GetAudiencesResponse = {
  audiences: Awaited<ReturnType<typeof listCustomAudiences>>["items"];
  nextCursor?: string;
  hasNextPage: boolean;
  queriedAt: string;
  limitations: string[];
};

type GetAudiencesErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

type GetWebsiteSourcesResponse = {
  sources: Array<{ id: string; name?: string; lastFiredTime?: string; source: ReturnType<typeof websiteSourceEvidence> }>;
  events: Array<{ pixelId: string; event: string }>;
  periodEvidence: ReturnType<typeof websitePeriodEvidenceBySource>;
  guidance?: string;
};

type GetInstagramSourcesResponse = {
  profiles: Array<{ id: string; username?: string; name?: string; source: ReturnType<typeof instagramSourceEvidence> }>;
  periodEvidence: typeof INSTAGRAM_PERIOD_EVIDENCE;
  guidance?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<
  NextResponse<GetAudiencesResponse | GetAudiencesErrorResponse | GetWebsiteSourcesResponse | GetInstagramSourcesResponse>
> {
  try {
    const { accountId } = await params;
    const userId = request.nextUrl.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(
      userId,
      "marketing:write",
    );
    if (!authz.ok) return authz.response;

    const tokenResult = await getUserAccessTokenByUserId(userId);

    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode },
      );
    }

    const connection = await getUserWithAdAccounts(tokenResult.accessToken, {
      tokenKind: tokenResult.connection.tokenKind,
      bisuAppScopedId: tokenResult.connection.bisuAppScopedId,
      clientBusinessId: tokenResult.connection.clientBusinessId,
      connectionName: tokenResult.connection.name,
    });
    assertCustomAudienceAccountAccess(
      accountId,
      connection.adaccounts?.data ?? [],
    );

    if (request.nextUrl.searchParams.get("sources") === "website") {
      const pixels = await getAdAccountPixels(accountId.startsWith("act_") ? accountId : `act_${accountId}`, tokenResult.accessToken);
      const websiteSources = await discoverWebsiteSources(pixels.data, tokenResult.accessToken);
      const sources = websiteSources.map((source) => ({ id: source.id, name: source.name, lastFiredTime: source.lastFiredTime, source: websiteSourceEvidence(websiteSources, source.id) }));
      return NextResponse.json({ sources, events: websiteSources.flatMap((source) => (source.observedEvents ?? []).map((event) => ({ pixelId: source.id, event }))), periodEvidence: websitePeriodEvidenceBySource(websiteSources.map((source) => source.id)), guidance: sources.some((source) => source.source.activity === "available") ? "Há Pixel acessível com atividade observada. Os eventos listados foram observados nos stats WEB_ONLY da própria fonte; os períodos permanecem impedidos enquanto a evidência por critério não estiver fechada." : "Nenhum Pixel com atividade recebida e acessível foi encontrado. Configure ou reautorize o rastreamento existente; esta tela não instala Pixel nem CAPI." });
    }
    if (request.nextUrl.searchParams.get("sources") === "instagram") {
      const profiles = await getAdvertisingIdentities(tokenResult.accessToken, accountId);
      const sourceProfiles = profiles.map((profile) => ({ id: profile.instagramBusinessAccountId, username: profile.instagramUsername, name: profile.pageName }));
      return NextResponse.json({
        profiles: sourceProfiles.map((profile) => ({ ...profile, source: instagramSourceEvidence(sourceProfiles, profile.id) })),
        periodEvidence: INSTAGRAM_PERIOD_EVIDENCE,
        guidance: profiles.length ? undefined : "Nenhum perfil profissional do Instagram acessível foi encontrado para esta conta. Conecte um perfil profissional a uma Página do Facebook e autorize o acesso existente; esta tela não cria ativos nem instala rastreamento.",
      });
    }

    const importHistory = await customerFileDurableStore().getLatestImportsForAccount(
      userId,
      accountId,
    );
    const page = await listCustomAudiences({
      adAccountId: accountId,
      accessToken: tokenResult.accessToken,
      detailed: request.nextUrl.searchParams.get("detailed") === "1",
      after: request.nextUrl.searchParams.get("after") ?? undefined,
      importHistory,
    });

    return NextResponse.json({
      audiences: page.items,
      hasNextPage: page.truncated,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      queriedAt: new Date().toISOString(),
      limitations: [
        "A consulta não comprova permissão para alterar, usar ou excluir o público.",
        "A Meta não informa membros individuais nem todos os usos em campanhas nesta consulta.",
      ],
    });
  } catch (error) {
    if (error instanceof AccountNotAccessibleError) {
      return NextResponse.json(
        { error: "Account not accessible", message: error.message },
        { status: 403 },
      );
    }
    const errorReturn = errorToGraphErrorReturn(error);

    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}

/** Backoffice uses the client's own Meta connection and repeats both its RBAC
 * check and account lookup on confirmation.  The browser review is never an
 * authorization grant. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  enterMetaMutationLog({
    app: "backoffice",
    route: "POST /api/meta-marketing/{accountId}/audiences",
    operationHint: "update",
    entityHint: "audience",
  });
  try {
    const { accountId } = await params;
    const userId = request.nextUrl.searchParams.get("userId");
    const body = await request.json() as { action?: "review" | "confirm" | "reconcile" | "delete-review" | "delete-confirm" | "instagram-review" | "instagram-confirm" | "instagram-reconcile" | "website-review" | "website-confirm" | "website-reconcile" | "lookalike-review" | "lookalike-confirm" | "lookalike-reconcile"; audienceId?: string; originAudienceId?: string; name?: string; description?: string; country?: string; percentage?: number; confirmationToken?: string; commandId?: string; profileId?: string; pixelId?: string; criterion?: string; retentionDays?: unknown; url?: string; event?: string };
    if (!userId || !body.action || (!body.action.startsWith("instagram-") && !body.action.startsWith("website-") && !body.action.startsWith("lookalike-") && !body.audienceId) || (!body.action.startsWith("instagram-") && !body.action.startsWith("website-") && !body.action.startsWith("lookalike-") && body.action !== "delete-review" && body.action !== "delete-confirm" && body.name == null && body.description == null)) return NextResponse.json({ error: "Invalid audience action" }, { status: 400 });
    const authz = await requireMarketingUserAccessResponse(userId, "marketing:write");
    if (!authz.ok) return authz.response;
    updateMetaMutationContext({
      actor: {
        kind: "backoffice",
        id: authz.actor.id,
        email: authz.actor.email,
        role: authz.actor.role,
        targetUserId: userId,
      },
      parentIds: { adAccountId: accountId },
      operationHint: body.action === "confirm" ? "confirm" : body.action ?? "review",
      entityHint: body.audienceId ? `audience:${body.audienceId}` : "audience",
    });
    const tokenResult = await getUserAccessTokenByUserId(userId);
    if (!tokenResult.success) return NextResponse.json(tokenResult.error, { status: tokenResult.error.statusCode });
    const commandStore = createPostgresAudienceCommandStore();
    const connection = await getUserWithAdAccounts(tokenResult.accessToken, { tokenKind: tokenResult.connection.tokenKind, bisuAppScopedId: tokenResult.connection.bisuAppScopedId, clientBusinessId: tokenResult.connection.clientBusinessId, connectionName: tokenResult.connection.name });
    assertCustomAudienceAccountAccess(accountId, connection.adaccounts?.data ?? []);
    if (body.action === "instagram-review" || body.action === "instagram-confirm" || body.action === "instagram-reconcile") {
      if (!body.name?.trim() || !body.profileId || !body.criterion || !Number.isInteger(body.retentionDays) || !["all", "engaged", "profile_visit", "messaged", "saved"].includes(body.criterion) || (body.action !== "instagram-review" && !body.confirmationToken)) return NextResponse.json({ error: "Invalid Instagram audience" }, { status: 400 });
      const profiles = await getAdvertisingIdentities(tokenResult.accessToken, accountId);
      const input = { adAccountId: accountId, accessToken: tokenResult.accessToken, name: body.name, description: body.description, selection: { profileId: body.profileId, criterion: body.criterion as InstagramAudienceCriterion, retentionDays: body.retentionDays as number }, audienceId: body.audienceId, profiles: profiles.map((profile) => ({ id: profile.instagramBusinessAccountId, username: profile.instagramUsername, name: profile.pageName })), confirmationToken: body.confirmationToken ?? "", commandId: body.commandId, actorUserId: userId, commandStore };
      const result = body.action === "instagram-review" ? await reviewInstagramAudience(input) : body.action === "instagram-confirm" ? await confirmInstagramAudience(input) : await reconcileInstagramAudience(input);
      const responseBody = !result.ok && result.issues.some((candidate) => candidate.code === "META_MUTATION_UNCERTAIN") ? { ...result, state: "reconciliation_required" as const } : result;
      return NextResponse.json(responseBody, { status: result.ok ? 200 : 409 });
    }
    if (body.action === "lookalike-review" || body.action === "lookalike-confirm" || body.action === "lookalike-reconcile") {
      if (!body.originAudienceId || !body.name?.trim() || !body.country || body.percentage == null || (body.action !== "lookalike-review" && !body.confirmationToken)) return NextResponse.json({ error: "Invalid lookalike" }, { status: 400 });
      const importHistory = await customerFileDurableStore().getLatestImportsForAudiences(userId, [body.originAudienceId], accountId);
      const input = { adAccountId: accountId, accessToken: tokenResult.accessToken, originAudienceId: body.originAudienceId, name: body.name, description: body.description, country: body.country, percentage: body.percentage, importHistory, confirmationToken: body.confirmationToken ?? "", commandId: body.commandId, actorUserId: userId, commandStore };
      const result = body.action === "lookalike-review" ? await reviewLookalikeAudience(input) : body.action === "lookalike-confirm" ? await confirmLookalikeAudience(input) : await reconcileLookalikeAudience(input);
      const responseBody = !result.ok && result.issues.some((candidate) => candidate.code === "META_MUTATION_UNCERTAIN") ? { ...result, state: "reconciliation_required" as const } : result;
      return NextResponse.json(responseBody, { status: result.ok ? 200 : 409 });
    }
    if (body.action === "website-review" || body.action === "website-confirm" || body.action === "website-reconcile") {
      if (!body.name?.trim() || !body.pixelId || !body.criterion || !Number.isInteger(body.retentionDays)) return NextResponse.json({ error: "Invalid website audience" }, { status: 400 });
      const pixels = await getAdAccountPixels(accountId.startsWith("act_") ? accountId : `act_${accountId}`, tokenResult.accessToken);
      const sources = await discoverWebsiteSources(pixels.data, tokenResult.accessToken);
      const input = { adAccountId: accountId, accessToken: tokenResult.accessToken, name: body.name, description: body.description, selection: { pixelId: body.pixelId, criterion: body.criterion as "visitors" | "url" | "event", retentionDays: body.retentionDays as number, url: body.url, event: body.event }, audienceId: body.audienceId, sources, confirmationToken: body.confirmationToken ?? "", commandId: body.commandId, actorUserId: userId, commandStore };
      const result = body.action === "website-review" ? await reviewWebsiteAudience(input) : body.action === "website-confirm" ? await confirmWebsiteAudience(input) : await reconcileWebsiteAudience(input);
      const responseBody = !result.ok && result.issues.some((candidate) => candidate.code === "META_MUTATION_UNCERTAIN") ? { ...result, state: "reconciliation_required" as const } : result;
      return NextResponse.json(responseBody, { status: result.ok ? 200 : 409 });
    }
    if (body.action === "delete-review" || body.action === "delete-confirm") {
      if (!body.audienceId) return NextResponse.json({ error: "Invalid audience action" }, { status: 400 });
      if (body.action === "delete-confirm" && !body.confirmationToken) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
      const result = await deleteCustomAudience({ audienceId: body.audienceId, adAccountId: accountId, accessToken: tokenResult.accessToken, confirm: body.action === "delete-confirm", confirmationToken: body.confirmationToken });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }
    if (!body.audienceId) return NextResponse.json({ error: "Invalid audience action" }, { status: 400 });
    if (body.action === "reconcile") {
      if (!body.confirmationToken) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
      const result = await reconcileAudienceMetadataUpdate({ audienceId: body.audienceId, adAccountId: accountId, accessToken: tokenResult.accessToken, name: body.name, description: body.description, confirmationToken: body.confirmationToken, commandId: body.commandId, actorUserId: userId, commandStore });
      const responseBody = !result.ok && result.issues.some((issue) => issue.code === "META_MUTATION_UNCERTAIN") ? { ...result, state: "reconciliation_required" as const } : result;
      return NextResponse.json(responseBody, { status: result.ok ? 200 : 409 });
    }
    if (body.action === "confirm") {
      if (!body.confirmationToken) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
      const result = await confirmAudienceMetadataUpdate({ audienceId: body.audienceId, adAccountId: accountId, accessToken: tokenResult.accessToken, name: body.name, description: body.description, confirmationToken: body.confirmationToken, commandId: body.commandId, actorUserId: userId, commandStore });
      const responseBody = !result.ok && result.issues.some((issue) => issue.code === "META_MUTATION_UNCERTAIN") ? { ...result, state: "reconciliation_required" as const } : result;
      return NextResponse.json(responseBody, { status: result.ok ? 200 : 409 });
    }
    const result = await previewAudienceMetadataUpdate({ audienceId: body.audienceId, adAccountId: accountId, accessToken: tokenResult.accessToken, name: body.name, description: body.description });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) { const errorReturn = errorToGraphErrorReturn(error); return NextResponse.json({ error: errorReturn.reason.title, message: errorReturn.reason.message, solution: errorReturn.reason.solution }, { status: errorReturn.statusCode }); }
}
