import {
  graphApiVersion,
  graphFacebookBaseUrl,
  graphInstagramBaseUrl,
} from "./constant";
import {
  genericError,
  GraphApiError,
  parseGraphError,
  type GraphErrorReturn,
} from "./error";

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

  const trimmedParams = params.trim();
  const query = trimmedParams ? `?${trimmedParams}` : "";
  const url = `${baseGraphUrl}/${graphApiVersion}/${path}${query}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${accessToken}`,
      },
      body,
    });

    if (!response.ok) {
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new GraphApiError({
          statusCode: response.status,
          reason: genericError,
          data: undefined,
        });
      }

      const errorReturn = parseGraphError(json);

      if (errorReturn.data) {
        throw new GraphApiError(errorReturn);
      }

      throw new GraphApiError({
        statusCode: response.status,
        reason: genericError,
        data: undefined,
      });
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof GraphApiError) {
      throw error;
    }

    throw error;
  }
}
