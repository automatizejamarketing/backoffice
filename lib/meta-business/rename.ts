import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";

/** Max length enforced for campaign/ad set/ad names (product requirement). */
export const MAX_NAME_LENGTH = 100;

export type NameValidationError = {
  title: string;
  message: string;
  solution: string;
};

/**
 * Trims and validates a name. Returns the normalized value or a client-safe
 * validation error (name required, max 100 chars).
 */
export function normalizeName(
  raw: unknown,
): { ok: true; name: string } | { ok: false; error: NameValidationError } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      ok: false,
      error: {
        title: "Nome obrigatório",
        message: "O nome não pode ficar vazio.",
        solution: "Informe um nome para o item.",
      },
    };
  }

  const name = raw.trim();

  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: {
        title: "Nome muito longo",
        message: `O nome deve ter no máximo ${MAX_NAME_LENGTH} caracteres.`,
        solution: `Reduza o nome para até ${MAX_NAME_LENGTH} caracteres.`,
      },
    };
  }

  return { ok: true, name };
}

/**
 * Renames a Meta object (campaign, ad set or ad) via `POST /{id}` with the
 * `name` field — the same mechanism the status/budget updates use. Reads the
 * current name first so callers can audit the previous value.
 */
export async function renameMetaObject(args: {
  objectId: string;
  name: string;
  accessToken: string;
}): Promise<{ previousName: string }> {
  const { objectId, name, accessToken } = args;

  const current = await metaApiCall<{ id: string; name?: string }>({
    domain: "FACEBOOK",
    method: "GET",
    path: objectId,
    params: "fields=id,name",
    accessToken,
  });

  const response = await metaApiCall<{ success?: boolean; id?: string }>({
    domain: "FACEBOOK",
    method: "POST",
    path: objectId,
    params: "",
    body: new URLSearchParams({ name }),
    accessToken,
  });

  if (response.success === false) {
    throw new GraphApiError({
      statusCode: 502,
      reason: {
        httpStatusCode: 502,
        title: "Falha ao renomear",
        message: "A Meta não confirmou a alteração do nome.",
        solution: "Tente novamente em alguns instantes.",
        isTransient: true,
      },
    });
  }

  return { previousName: current.name ?? "" };
}
