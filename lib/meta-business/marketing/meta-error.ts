import { genericError, GraphApiError, parseGraphError } from "../error";

/**
 * Multipart uploads to the Graph API use raw `fetch` (metaApiCall forces
 * x-www-form-urlencoded). This normalizes a failed Meta JSON body into the
 * same GraphApiError the rest of the backoffice maps to client responses.
 */
export function throwMetaError(data: unknown, responseStatus: number): never {
  const errorReturn = parseGraphError(data);
  if (errorReturn.data) {
    throw new GraphApiError(errorReturn);
  }
  throw new GraphApiError({
    statusCode: responseStatus,
    reason: genericError,
    data: undefined,
  });
}
