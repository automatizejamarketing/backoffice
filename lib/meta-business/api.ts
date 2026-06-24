import {
  graphApiVersion,
  graphFacebookBaseUrl,
  graphInstagramBaseUrl,
} from "./constant";
import {
  genericError,
  GraphApiError,
  parseGraphError,
  parseRateLimitHeaders,
  type GraphErrorReturn,
} from "./error";
import { appSecretProofParam, facebookAppSecret } from "./appsecret-proof";
import { logMetaCall } from "@/lib/observability/meta-logger";

export type MetaApiCallParams = {
  domain?: "FACEBOOK" | "INSTAGRAM";
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  /** Query string without leading `?` (e.g. `fields=id,name`) */
  params: string;
  body?: string | URLSearchParams;
  accessToken: string;
};

export async function metaApiCall<T>({
  domain = "FACEBOOK",
  method,
  path,
  params,
  body,
  accessToken,
}: MetaApiCallParams): Promise<T> {
  if (!accessToken) {
    throw new GraphApiError({
      statusCode: 400,
      reason: {
        httpStatusCode: 400,
        title: "Token de acesso é obrigatório",
        message: "Token de acesso é obrigatório",
        solution: "Forneça um token de acesso válido",
        isTransient: false,
      },
    });
  }

  const baseGraphUrl =
    domain === "FACEBOOK" ? graphFacebookBaseUrl : graphInstagramBaseUrl;

  // appsecret_proof only for FACEBOOK (user token + META_GENERAL_APP_SECRET).
  // INSTAGRAM uses a different secret and is left byte-identical to before.
  const appSecret = domain === "FACEBOOK" ? facebookAppSecret() : undefined;
  const proof = appSecretProofParam(accessToken, appSecret);

  const trimmedParams = params.trim();
  const qsParts = [trimmedParams, proof].filter(Boolean);
  const query = qsParts.length ? `?${qsParts.join("&")}` : "";
  const url = `${baseGraphUrl}/${graphApiVersion}/${path}${query}`;
  const endpoint = `${baseGraphUrl}/${graphApiVersion}/${path}`;
  const requestParams = trimmedParams || body;
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${accessToken}`,
      },
      body,
    });

    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      // Rate-limit timing (Retry-After / estimated_time_to_regain_access) so the
      // caller can back off the server-suggested amount instead of guessing.
      const rateLimit = parseRateLimitHeaders(response.headers);
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        logMetaCall({
          phase: "error",
          method,
          endpoint,
          requestParams,
          httpStatus: response.status,
          durationMs,
        });
        throw new GraphApiError({
          statusCode: response.status,
          reason: genericError,
          data: undefined,
          ...(rateLimit && { rateLimit }),
        });
      }

      logMetaCall({
        phase: "error",
        method,
        endpoint,
        requestParams,
        httpStatus: response.status,
        durationMs,
        errorData: json,
      });

      const errorReturn = parseGraphError(json);

      if (errorReturn.data) {
        throw new GraphApiError({
          ...errorReturn,
          ...(rateLimit && { rateLimit }),
        });
      }

      throw new GraphApiError({
        statusCode: response.status,
        reason: genericError,
        data: undefined,
        ...(rateLimit && { rateLimit }),
      });
    }

    const json = (await response.json()) as T;
    logMetaCall({
      phase: "success",
      method,
      endpoint,
      requestParams,
      httpStatus: response.status,
      durationMs,
      responseData: json,
      entityId:
        json && typeof json === "object" && "id" in (json as object)
          ? String((json as unknown as { id: string }).id)
          : undefined,
    });

    return json;
  } catch (error) {
    if (!(error instanceof GraphApiError)) {
      logMetaCall({
        phase: "error",
        method,
        endpoint,
        requestParams,
        durationMs: Date.now() - startedAt,
        errorData: {
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
    }

    if (error instanceof GraphApiError) {
      throw error;
    }

    throw error;
  }
}
