import {
  graphApiVersion,
  graphFacebookBaseUrl,
  graphInstagramBaseUrl,
} from "./constant";
import { genericError, GraphApiError, parseGraphError, type GraphErrorReturn } from "./error";

export type MetaApiCallParams = {
  domain?: "FACEBOOK" | "INSTAGRAM";
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
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

  const url = `${baseGraphUrl}/${graphApiVersion}/${path}?${params}&access_token=${accessToken}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    if (!response.ok) {
      // Tenta parsear a resposta como JSON
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        // Se não conseguir parsear JSON, é um erro não mapeado (ex: HTML error page)
        throw new GraphApiError({
          statusCode: response.status,
          reason: genericError,
          data: undefined,
        });
      }

      // Usa parseGraphError para identificar e mapear erros do Graph API
      const errorReturn = parseGraphError(json);
      
      // Se é um erro do Graph API mapeado, lança GraphApiError
      if (errorReturn.data) {
        throw new GraphApiError(errorReturn);
      }

      // Não é um erro do Graph API formatado - lança erro genérico
      throw new GraphApiError(
        {
          statusCode: response.status,
          reason: genericError,
          data: undefined,
        }
      );
    }

    return response.json() as Promise<T>;
  } catch (error) {
    // Se já é um GraphApiError, relança
    if (error instanceof GraphApiError) {
      throw error;
    }

    // Se é um erro de rede ou outro erro não mapeado, relança
    throw error;
  }
}
