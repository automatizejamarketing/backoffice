import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  AccountNotAccessibleError,
  assertCustomAudienceAccountAccess,
  listCustomAudiences,
  deleteCustomAudience,
  buildWebsiteAudienceRule,
  assessLookalikeSource,
  buildLookalikeFormation,
  createCustomAudience,
  getCustomAudienceDetail,
} from "@/lib/meta-business/marketing/audiences";
import { getAdAccountPixels } from "@/lib/meta-business/get-ad-account-pixels";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import { metaApiCall } from "@/lib/meta-business/api";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GetAudiencesResponse | GetAudiencesErrorResponse>> {
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
      const sources = pixels.data.filter((pixel) => pixel.is_unavailable !== true && Boolean(pixel.last_fired_time)).map((pixel) => ({ id: pixel.id, name: pixel.name, lastFiredTime: pixel.last_fired_time }));
      return NextResponse.json({ sources, events: [], guidance: sources.length ? "A fonte tem atividade observada. Eventos específicos não são oferecidos sem uma observação autenticada da fonte; a tela não usa catálogo genérico." : "Nenhum Pixel com atividade recebida e acessível foi encontrado. Configure ou reautorize o rastreamento existente; esta tela não instala Pixel nem CAPI." });
    }

    const page = await listCustomAudiences({
      adAccountId: accountId,
      accessToken: tokenResult.accessToken,
      detailed: request.nextUrl.searchParams.get("detailed") === "1",
      after: request.nextUrl.searchParams.get("after") ?? undefined,
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
  try {
    const { accountId } = await params;
    const userId = request.nextUrl.searchParams.get("userId");
    const body = await request.json() as { action?: "review" | "confirm" | "delete-review" | "delete-confirm" | "website-create" | "website-update" | "lookalike-review" | "lookalike-confirm"; audienceId?: string; originAudienceId?: string; name?: string; description?: string; country?: string; percentage?: number; confirmationToken?: string; pixelId?: string; criterion?: "visitors" | "url" | "event"; retentionDays?: unknown; url?: string; event?: string };
    if (!userId || (!body.audienceId && body.action !== "website-create" && body.action !== "lookalike-review" && body.action !== "lookalike-confirm") || (body.action !== "delete-review" && body.action !== "delete-confirm" && body.action !== "website-create" && body.action !== "website-update" && body.action !== "lookalike-review" && body.action !== "lookalike-confirm" && body.name == null && body.description == null)) return NextResponse.json({ error: "Invalid audience action" }, { status: 400 });
    const authz = await requireMarketingUserAccessResponse(userId, "marketing:write");
    if (!authz.ok) return authz.response;
    const tokenResult = await getUserAccessTokenByUserId(userId);
    if (!tokenResult.success) return NextResponse.json(tokenResult.error, { status: tokenResult.error.statusCode });
    const connection = await getUserWithAdAccounts(tokenResult.accessToken, { tokenKind: tokenResult.connection.tokenKind, bisuAppScopedId: tokenResult.connection.bisuAppScopedId, clientBusinessId: tokenResult.connection.clientBusinessId, connectionName: tokenResult.connection.name });
    assertCustomAudienceAccountAccess(accountId, connection.adaccounts?.data ?? []);
    if (body.action === "lookalike-review" || body.action === "lookalike-confirm") {
      if (!body.originAudienceId || !body.name?.trim() || !body.country || body.percentage == null) return NextResponse.json({ error: "Invalid lookalike" }, { status: 400 });
      const formation = buildLookalikeFormation({ country: body.country, percentage: body.percentage });
      if (!formation.ok) return NextResponse.json({ error: "Invalid lookalike", message: formation.message }, { status: 400 });
      const source = await getCustomAudienceDetail({ audienceId: body.originAudienceId, accessToken: tokenResult.accessToken });
      const eligibility = assessLookalikeSource(source);
      if (!eligibility.ok) return NextResponse.json({ error: eligibility.code, message: eligibility.message }, { status: 409 });
      const confirmationToken = JSON.stringify({ accountId, originAudienceId: source.id, name: body.name.trim(), description: body.description, ...formation.formation });
      if (body.action === "lookalike-review") return NextResponse.json({ ok: true, confirmationToken, source: { id: source.id, name: source.name }, formation: formation.formation, state: "ready_to_submit", notice: "O percentual define o tamanho do p\u00fablico semelhante no pa\u00eds. Ele n\u00e3o mede confian\u00e7a, correspond\u00eancia nem pessoas importadas." });
      if (body.confirmationToken !== confirmationToken) return NextResponse.json({ error: "STALE_REVIEW", message: "Revise novamente antes de criar o p\u00fablico semelhante." }, { status: 409 });
      const created = await createCustomAudience({ adAccountId: accountId, accessToken: tokenResult.accessToken, type: "lookalike", originAudienceId: source.id, name: body.name, description: body.description, lookalikeCountry: formation.formation.country, lookalikeRatio: formation.formation.ratio });
      return NextResponse.json(created.ok ? { ok: true, id: created.id, state: "submitted" } : created, { status: created.ok ? 200 : 409 });
    }
    if (body.action === "website-create" || body.action === "website-update") {
      if (!body.name?.trim() || !body.pixelId || !body.criterion || !Number.isInteger(body.retentionDays)) return NextResponse.json({ error: "Invalid website audience" }, { status: 400 });
      const pixels = await getAdAccountPixels(accountId.startsWith("act_") ? accountId : `act_${accountId}`, tokenResult.accessToken);
      if (!pixels.data.some((pixel) => pixel.id === body.pixelId && pixel.is_unavailable !== true && pixel.last_fired_time)) return NextResponse.json({ error: "Website source unavailable", message: "O Pixel escolhido não tem atividade recebida acessível nesta conta." }, { status: 409 });
      try {
        const payload = new URLSearchParams({ name: body.name.trim(), rule: JSON.stringify(buildWebsiteAudienceRule({ pixelId: body.pixelId, criterion: body.criterion, retentionDays: body.retentionDays as number, url: body.url, event: body.event })) });
        if (body.action === "website-create") payload.set("prefill", "true");
        if (body.description) payload.set("description", body.description);
        const path = body.action === "website-create" ? `act_${accountId.replace(/^act_/, "")}/customaudiences` : body.audienceId!;
        const result = await metaApiCall<{ id?: string; success?: boolean }>({ method: "POST", path, params: "", body: payload, accessToken: tokenResult.accessToken });
        return NextResponse.json({ ok: true, id: result.id ?? body.audienceId });
      } catch (error) { return NextResponse.json({ error: "Invalid website rule", message: error instanceof Error ? error.message : "Não foi possível salvar a regra do site." }, { status: 409 }); }
    }
    if (body.action === "delete-review" || body.action === "delete-confirm") {
      if (body.action === "delete-confirm" && !body.confirmationToken) return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
      const result = await deleteCustomAudience({ audienceId: body.audienceId, adAccountId: accountId, accessToken: tokenResult.accessToken, confirm: body.action === "delete-confirm", confirmationToken: body.confirmationToken });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }
    const snapshot = await metaApiCall<{ account_id?: string; name?: string; description?: string; lookalike_audience_ids?: string[] }>({ method: "GET", path: body.audienceId, params: "fields=account_id,name,description,rule,lookalike_audience_ids", accessToken: tokenResult.accessToken });
    if (snapshot.account_id?.replace(/^act_/, "") !== accountId.replace(/^act_/, "")) return NextResponse.json({ error: "Audience not in account" }, { status: 403 });
    const before = { name: snapshot.name, description: snapshot.description }; const after = { name: body.name ?? snapshot.name, description: body.description ?? snapshot.description };
    const confirmationToken = JSON.stringify({ audienceId: body.audienceId, accountId, before, after });
    if (body.action === "confirm") {
      if (body.confirmationToken !== confirmationToken) return NextResponse.json({ error: "Stale review; review again before confirming" }, { status: 409 });
      const payload = new URLSearchParams(); if (body.name != null) payload.set("name", body.name); if (body.description != null) payload.set("description", body.description);
      await metaApiCall({ method: "POST", path: body.audienceId, params: "", body: payload, accessToken: tokenResult.accessToken });
      return NextResponse.json({ ok: true, id: body.audienceId });
    }
    const adsets = await metaApiCall<{ data?: Array<{ id?: string; name?: string; campaign?: { id?: string; name?: string }; targeting?: { custom_audiences?: Array<{ id?: string }>; excluded_custom_audiences?: Array<{ id?: string }> } }>; paging?: { next?: string } }>({ method: "GET", path: `act_${accountId.replace(/^act_/, "")}/adsets`, params: "fields=id,name,campaign{id,name},targeting{custom_audiences,excluded_custom_audiences}&limit=200", accessToken: tokenResult.accessToken });
    const knownUses = (adsets.data ?? []).flatMap((adset) => ["include", "exclude"].flatMap((placement) => (placement === "include" ? adset.targeting?.custom_audiences : adset.targeting?.excluded_custom_audiences)?.some((ref) => ref.id === body.audienceId) && adset.id ? [{ adSetId: adset.id, adSetName: adset.name, campaignId: adset.campaign?.id, campaignName: adset.campaign?.name, placement }] : []));
    return NextResponse.json({ ok: true, before, after, confirmationToken, impact: { knownUses, dependentAudienceIds: snapshot.lookalike_audience_ids ?? [], coverage: adsets.paging?.next ? "incomplete" : "complete", limitations: adsets.paging?.next ? ["A consulta possui mais páginas; podem existir usos não exibidos."] : ["A Meta não garante a ausência global de anúncios afetados."] } });
  } catch (error) { const errorReturn = errorToGraphErrorReturn(error); return NextResponse.json({ error: errorReturn.reason.title, message: errorReturn.reason.message, solution: errorReturn.reason.solution }, { status: errorReturn.statusCode }); }
}
