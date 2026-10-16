/**
 * Create a Meta pixel on an ad account — `POST act_<id>/adspixels` with `name`, the only
 * creation path Meta documents (Marketing API v25). An account holds one pixel: a second
 * create is refused with 6200/6202, and a pixel can never be deleted afterwards.
 *
 * Goes through `metaWrite` (appsecret_proof, object-busy + throttle retry, `meta_mutation`
 * log) and returns the ADR 0009 {@link CreateResult} instead of throwing, so the Mat can
 * self-correct and both apps map the same issue codes.
 *
 * MIRRORED DIR — the backoffice runs this file too. Edit here, then `bun run sync:meta`.
 *
 * @see https://developers.facebook.com/docs/marketing-api/reference/ad-account/adspixels/
 */

import { GraphApiError } from "@/lib/meta-business/error";
import { metaWrite } from "@/lib/meta-business/write-retry";
import { issuesFromError } from "./normalize";
import { fail, ok, type CreateIssue, type CreateResult } from "./types";

export const PIXEL_NAME_MAX_LENGTH = 100;

export type CreatedPixel = { id: string; name: string };

const CREATE = { stage: "create", level: "pixel" } as const;

function invalidName(reason: string): CreateIssue {
  return {
    stage: "local",
    level: "pixel",
    code: "PIXEL_INVALID_PARAMETER",
    reason,
    suggestion: "Confira o nome do pixel e tente novamente.",
    field: ["name"],
  };
}

/** Meta error → issue: the three documented creation codes get their own ids. */
function pixelCreateIssue(error: unknown): CreateIssue {
  const data = error instanceof GraphApiError ? error.errorReturn.data : undefined;
  const code = data?.code;
  if (code === 6200 || code === 6202) {
    return {
      ...CREATE,
      code: "PIXEL_ALREADY_EXISTS",
      reason: "Esta conta de anúncio atingiu o limite de pixels (já existe pixel).",
      suggestion:
        "Use getPixels e reutilize um pixel existente (pixel_id) na campanha em vez de criar outro.",
      metaCode: code,
    };
  }
  if (code === 200) {
    return {
      ...CREATE,
      code: "PIXEL_PERMISSION_DENIED",
      reason: "Sem permissão para criar pixel nesta conta de anúncio.",
      suggestion:
        "Confirme que o usuário é administrador/anunciante da conta e, se preciso, reconecte o Facebook em /app/marketing.",
      metaCode: code,
    };
  }
  if (code === 100) {
    return {
      ...CREATE,
      code: "PIXEL_INVALID_PARAMETER",
      reason: data?.errorUserMsg ?? data?.message ?? "Parâmetro inválido ao criar o pixel.",
      suggestion: "Confira o nome do pixel e tente novamente.",
      metaCode: code,
    };
  }
  return issuesFromError(error, "create", "pixel")[0];
}

/**
 * Creates the pixel. Accepts the account id with or without `act_`. The name is trimmed and
 * checked locally first (non-empty, at most {@link PIXEL_NAME_MAX_LENGTH}) — no Meta call
 * when it fails.
 */
export async function createAdAccountPixelChecked(
  adAccountId: string,
  accessToken: string,
  name: string,
): Promise<CreateResult<CreatedPixel>> {
  const trimmed = name.trim();
  if (!trimmed) return fail([invalidName("O nome do pixel é obrigatório.")]);
  if (trimmed.length > PIXEL_NAME_MAX_LENGTH) {
    return fail([
      invalidName(`O nome do pixel pode ter no máximo ${PIXEL_NAME_MAX_LENGTH} caracteres.`),
    ]);
  }

  const account = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  try {
    const res = await metaWrite<{ id: string }>({
      method: "POST",
      path: `${account}/adspixels`,
      params: "",
      body: new URLSearchParams({ name: trimmed }),
      accessToken,
    });
    return ok(res.id, { id: res.id, name: trimmed });
  } catch (error) {
    return fail([pixelCreateIssue(error)]);
  }
}
