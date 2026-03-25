export type GraphErrorInfo = {
  message: string;
  type: string;
  code: number;
  errorSubcode?: number;
  errorUserTitle?: string;
  errorUserMsg?: string;
  fbtraceId?: string;
};

export type GraphErrorJSONResponse<T> = {
  error: GraphErrorInfo & T;
};

export type GraphErrorReturn = {
  statusCode: number;
  reason: MappedError;
  data?: GraphErrorInfo;
};

/**
 * Custom error class for Graph API errors.
 * Contains standardized error information from parseGraphError.
 */
export class GraphApiError extends Error {
  readonly errorReturn: GraphErrorReturn;

  constructor(errorReturn: GraphErrorReturn) {
    super(errorReturn.reason.message);
    this.name = "GraphApiError";
    this.errorReturn = errorReturn;
  }
}

/**
 * Verifica se um objeto JSON é um erro do Graph API.
 */
function isGraphApiError(json: unknown): json is { error: unknown } {
  return (
    typeof json === "object" &&
    json !== null &&
    "error" in json &&
    typeof (json as { error: unknown }).error === "object" &&
    (json as { error: Record<string, unknown> }).error !== null
  );
}

/**
 * Verifica se um erro do Graph API tem a estrutura esperada.
 */
function isValidGraphErrorInfo(error: unknown): error is {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
} {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const err = error as Record<string, unknown>;
  return (
    typeof err["message"] === "string" &&
    typeof err["type"] === "string" &&
    typeof err["code"] === "number"
  );
}

export function parseGraphError(json: unknown): GraphErrorReturn {
  // Verifica se é um erro do Graph API formatado corretamente
  if (isGraphApiError(json) && isValidGraphErrorInfo(json.error)) {
    // É um erro do Graph API - mapeia para o formato padrão
    const errorInfo: GraphErrorInfo = {
      message: json.error.message,
      type: json.error.type,
      code: json.error.code,
      errorSubcode: json.error.error_subcode,
      errorUserTitle: json.error.error_user_title,
      errorUserMsg: json.error.error_user_msg,
      fbtraceId: json.error.fbtrace_id,
    };

    const mappedError = findMappedError(errorInfo.code, errorInfo.errorSubcode);

    return {
      statusCode: mappedError.httpStatusCode,
      reason: mappedError,
      data: errorInfo,
    };
  } else {
    return {
      statusCode: 500,
      reason: genericError,
    };
  }
}

/**
 * Definição interna de um erro mapeado.
 */
interface MappedError {
  httpStatusCode: number;
  title: string;
  message: string;
  solution: string;
  isTransient: boolean;
}

/**
 * Erro genérico para quando nenhum mapeamento é encontrado.
 */
export const genericError: MappedError = {
  httpStatusCode: 500,
  title: "Erro Desconhecido",
  message: "Ocorreu um erro inesperado ao processar sua requisição.",
  solution:
    "Tente novamente. Se o problema persistir, entre em contato com o suporte.",
  isTransient: true,
};

/**
 * Mapa de erros conhecidos da API do Instagram e Facebook Marketing API.
 * Chave: `${code}_${subcode}` ou `${code}` quando subcode não é específico.
 */
const errorMap: Record<string, MappedError> = {
  "1": {
    httpStatusCode: 500,
    title: "Erro desconhecido da API",
    message:
      "A API retornou um erro desconhecido. Pode ser temporário ou um bug.",
    solution: "Tente novamente em alguns instantes.",
    isTransient: true,
  },
  "2": {
    httpStatusCode: 503,
    title: "Serviço temporariamente indisponível",
    message: "O serviço da Meta está temporariamente indisponível.",
    solution: "Aguarde alguns minutos e tente novamente.",
    isTransient: true,
  },
  "4": {
    httpStatusCode: 429,
    title: "Limite de chamadas da API",
    message:
      "Muitas chamadas à API em pouco tempo. A Meta aplicou limite de taxa.",
    solution:
      "Reduza a frequência das requisições e aguarde antes de tentar de novo.",
    isTransient: true,
  },
  "17": {
    httpStatusCode: 429,
    title: "Limite do usuário excedido",
    message: "O usuário excedeu o limite de chamadas permitido.",
    solution: "Aguarde e tente novamente mais tarde.",
    isTransient: true,
  },
  "32": {
    httpStatusCode: 429,
    title: "Limite de taxa",
    message: "Limite de taxa da API atingido.",
    solution: "Implemente backoff e tente novamente.",
    isTransient: true,
  },
  "100": {
    httpStatusCode: 400,
    title: "Parâmetro inválido",
    message:
      "Um ou mais parâmetros da requisição são inválidos para a Marketing API.",
    solution:
      "Verifique os IDs, campos e formato dos dados conforme a documentação da Meta.",
    isTransient: false,
  },
  "368": {
    httpStatusCode: 403,
    title: "Conta temporariamente bloqueada",
    message:
      "A conta está temporariamente impedida de realizar esta ação por políticas da Meta.",
    solution: "Revise as políticas de anúncios e o status da conta na Meta.",
    isTransient: false,
  },
  "2635": {
    httpStatusCode: 400,
    title: "Segmentação do conjunto de anúncios inválida",
    message:
      "A segmentação (targeting) do conjunto de anúncios não é válida ou não é permitida.",
    solution:
      "Ajuste idade, localização, públicos e demais campos de segmentação.",
    isTransient: false,
  },
  "102": {
    httpStatusCode: 401,
    title: "Sessão da API",
    message:
      "O status de login ou o token de acesso expirou, foi revogado ou é inválido (sem subcódigo).",
    solution: "Obtenha um novo token de acesso e tente novamente.",
    isTransient: false,
  },
  "190": {
    httpStatusCode: 401,
    title: "Token de Acesso Expirou",
    message: "O token de acesso expirou, foi revogado ou é inválido.",
    solution: "Obtenha um novo token (reauth/refresh) e tente novamente.",
    isTransient: false,
  },
  "200": {
    httpStatusCode: 403,
    title: "Erro de Permissão",
    message: "O usuário não tem permissão para realizar esta ação.",
    solution:
      "Verifique se o usuário tem as permissões necessárias para esta operação.",
    isTransient: false,
  },
  "294": {
    httpStatusCode: 403,
    title: "Permissão ads_management Necessária",
    message:
      "Gerenciar anúncios requer a permissão estendida ads_management e um aplicativo na lista de permissões para acessar a Marketing API.",
    solution:
      "Solicite a permissão ads_management e verifique se seu app tem acesso à Marketing API.",
    isTransient: false,
  },
};

/**
 * Encontra o erro mapeado baseado no código e subcódigo.
 */
export function findMappedError(code: number, subcode?: number): MappedError {
  // Primeiro tenta encontrar pelo código + subcódigo específico
  if (subcode !== undefined) {
    const specificKey = `${code}_${subcode}`;
    if (errorMap[specificKey]) {
      return errorMap[specificKey];
    }
  }

  // Depois tenta encontrar apenas pelo código
  const codeOnlyKey = String(code);
  if (errorMap[codeOnlyKey]) {
    return errorMap[codeOnlyKey];
  }

  // Se não encontrou, retorna erro genérico
  return genericError;
}

/**
 * Converts an error to GraphErrorReturn format.
 * Handles GraphApiError instances and other errors.
 */
export function errorToGraphErrorReturn(error: unknown): GraphErrorReturn {
  if (error instanceof GraphApiError) {
    return error.errorReturn;
  }

  // Never expose raw DB/SQL messages or stack details to API clients
  console.error("[errorToGraphErrorReturn] Non-Graph error:", error);

  return {
    statusCode: 500,
    reason: {
      httpStatusCode: 500,
      title: "Erro interno",
      message: genericError.message,
      solution: genericError.solution,
      isTransient: true,
    },
  };
}
