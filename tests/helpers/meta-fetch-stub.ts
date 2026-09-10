/**
 * Layer-2 harness (test plan §2.2). `metaApiCall` (lib/meta-business/api.ts) reaches Meta
 * through the GLOBAL `fetch`, so a test can intercept every Graph call by swapping
 * `globalThis.fetch`. The stub:
 *   - records each Graph request (method, path, merged query+body params, validate_only) so a
 *     test can assert the OUTGOING payload (status=PAUSED, daily_budget=5000, …) and the order
 *     (validate_only precedes the real create; NO Meta call on a local-validation failure);
 *   - returns whatever the test's handler scripts (validate_only → {success:true} by default;
 *     create → {id}; GET → entity JSON; error → 4xx with a Graph error body).
 *
 * Only `graph.facebook.com` / `graph.instagram.com` are intercepted; any other fetch passes
 * through (there should be none in a hermetic test — if one appears, that itself is a finding).
 */

export type MetaRequest = {
  method: string;
  url: string;
  /** Pathname with the `/vXX.X/` version prefix stripped, e.g. `act_123/campaigns` or `120.../`. */
  path: string;
  /** Query params merged with the (urlencoded) POST body — where the payload lives. */
  params: URLSearchParams;
  isValidateOnly: boolean;
  bodyText: string;
};

export type MetaStubResponse = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Corpo CRU, entregue sem `JSON.stringify` e sem forçar
   * `content-type: application/json`. Existe para reproduzir a resposta que a
   * Meta mandou em produção no lugar de JSON — a página `<!DOCTYPE html>` de
   * login/WAF/CDN do §5.3 do relatório Vercel 2026-08-18. Passe o
   * `content-type` real em `headers`.
   */
  raw?: string;
};

export type MetaHandler = (
  req: MetaRequest,
) => MetaStubResponse | undefined | Promise<MetaStubResponse | undefined>;

export type MetaFetchStub = {
  /** Every intercepted Graph request, in order. */
  calls: MetaRequest[];
  /** Requests that were real (non-validate_only) writes/reads — the "cost" tally. */
  realCalls: () => MetaRequest[];
  restore: () => void;
};

const GRAPH = /graph\.(facebook|instagram)\.com/i;

export function installMetaFetchStub(handler: MetaHandler): MetaFetchStub {
  const calls: MetaRequest[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : ((input as { url?: string })?.url ?? String(input));

    if (!GRAPH.test(url)) {
      // Not a Graph call — let it through (a hermetic test shouldn't produce these).
      return (original as typeof fetch)(input as RequestInfo, init);
    }

    const u = new URL(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : init?.body
          ? String(init.body)
          : "";

    const params = new URLSearchParams(u.searchParams);
    for (const [k, v] of new URLSearchParams(bodyText)) params.append(k, v);

    const fullPath = u.pathname.replace(/^\/+/, "");
    const path = fullPath.replace(/^v\d+\.\d+\//, "");
    const isValidateOnly = /validate_only/.test(params.get("execution_options") ?? "");

    const req: MetaRequest = { method, url, path, params, isValidateOnly, bodyText };
    calls.push(req);

    const scripted = (await handler(req)) ?? {};
    const status = scripted.status ?? 200;

    if (scripted.raw !== undefined) {
      return new Response(scripted.raw, {
        status,
        headers: { ...(scripted.headers ?? {}) },
      });
    }

    const body =
      scripted.body ?? (isValidateOnly ? { success: true } : {});

    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...(scripted.headers ?? {}) },
    });
  }) as typeof fetch;

  return {
    calls,
    realCalls: () => calls.filter((c) => !c.isValidateOnly),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** A Graph error body (matches what `parseGraphError` reads). */
export function graphErrorBody(args: {
  message?: string;
  code?: number;
  errorSubcode?: number;
  isTransient?: boolean;
  userTitle?: string;
  userMsg?: string;
}): { error: Record<string, unknown> } {
  return {
    error: {
      message: args.message ?? "error",
      type: "OAuthException",
      code: args.code ?? 100,
      ...(args.errorSubcode != null && { error_subcode: args.errorSubcode }),
      is_transient: args.isTransient ?? false,
      ...(args.userTitle && { error_user_title: args.userTitle }),
      ...(args.userMsg && { error_user_msg: args.userMsg }),
    },
  };
}

/** Rate-limit response headers (so `parseRateLimitHeaders` yields a wait). */
export function rateLimitHeaders(estimatedMinutes = 5): Record<string, string> {
  return {
    "x-business-use-case-usage": JSON.stringify({
      "0": [{ estimated_time_to_regain_access: estimatedMinutes }],
    }),
  };
}

/** Tests that touch `metaApiCall` need a non-empty app secret for the appsecret_proof step. */
export function ensureMetaTestEnv(): void {
  process.env.META_GENERAL_APP_SECRET ??= "test-app-secret";
}

