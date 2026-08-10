import { NextRequest, NextResponse } from "next/server";

import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { findActions } from "@/lib/db/meta-tracking-correlation-queries";
import { getAccountTrackingCurrency } from "@/lib/db/meta-tracking-operation-queries";
import {
  buildActionHistory,
  mergeActionStreams,
  serializeActionHistory,
} from "@/lib/meta-tracking/action-history-view";
import type { TrackingHistoryResponse } from "@/lib/meta-tracking/action-history-view";
import type { MetaTrackingEntityLevel } from "@/lib/db/schema";

type TrackingHistoryErrorResponse = {
  error: string;
  message?: string;
};

const ENTITY_LEVELS: readonly MetaTrackingEntityLevel[] = [
  "campaign",
  "adset",
  "ad",
];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

/**
 * O histórico unificado de ações de uma entidade — todas as origens numa linha
 * do tempo só, com motivo quando existir.
 *
 * São duas consultas porque a hierarquia é desnormalizada em uma direção só: a
 * campanha guarda `campaign_id` nulo e os filhos o carregam. "Tudo que
 * aconteceu nesta campanha" é, portanto, a união do que aconteceu nela com o
 * que aconteceu na descendência dela.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<TrackingHistoryResponse | TrackingHistoryErrorResponse>> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get("userId");
    const entityId = searchParams.get("entityId");
    const entityLevel = searchParams.get("entityLevel") as
      | MetaTrackingEntityLevel
      | null;

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId identifica de quem é a conta de anúncio",
        },
        { status: 400 },
      );
    }

    if (!entityId || !entityLevel || !ENTITY_LEVELS.includes(entityLevel)) {
      return NextResponse.json(
        {
          error: "Invalid entity",
          message: "entityLevel (campaign|adset|ad) e entityId são obrigatórios",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    const { accountId } = await params;
    const limit = parseLimit(searchParams.get("limit"));
    const scope = { accountId, userId, limit };

    const descendantFilter =
      entityLevel === "campaign"
        ? { campaignId: entityId }
        : entityLevel === "adset"
          ? { adsetId: entityId }
          : null;

    const [ownActions, descendantActions, currency] = await Promise.all([
      findActions({ ...scope, entityLevel, entityId }),
      descendantFilter
        ? findActions({ ...scope, ...descendantFilter })
        : Promise.resolve([]),
      getAccountTrackingCurrency(accountId),
    ]);

    const actions = serializeActionHistory(
      buildActionHistory(
        mergeActionStreams([ownActions, descendantActions], limit),
        { currency },
      ),
    );

    return NextResponse.json({ actions, currency }, { status: 200 });
  } catch (error) {
    console.error("Error fetching tracking action history:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar o histórico de ações",
      },
      { status: 500 },
    );
  }
}
