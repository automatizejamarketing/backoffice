import { NextResponse } from "next/server";
import {
  getMetaLogContext,
  newCorrelationId,
  runWithMetaLogContextAsync,
  type MetaLogActor,
  type MetaLogContext,
} from "./meta-log-context";
import { logMetaMutationError } from "./meta-logger";

export type WithMetaMutationLoggingOptions = {
  app: "automatize-frontend" | "backoffice";
  route: string;
  actor?: MetaLogActor;
  operationHint?: string;
  entityHint?: string;
  parentIds?: MetaLogContext["parentIds"];
};

export function getCorrelationIdFromContext(): string | undefined {
  return getMetaLogContext()?.correlationId;
}

export function attachCorrelationId<T extends Record<string, unknown>>(
  body: T,
): T & { correlationId?: string } {
  const correlationId = getCorrelationIdFromContext();
  if (!correlationId) return body;
  return { ...body, correlationId };
}

/** Builds a MetaLogContext with a fresh correlationId for a mutation route. */
export function initMetaMutationLog(
  options: Omit<MetaLogContext, "correlationId">,
): MetaLogContext {
  return {
    correlationId: newCorrelationId(),
    ...options,
  };
}

/** Runs a handler inside AsyncLocalStorage mutation-log context. */
export async function wrapMetaMutationHandler<T>(
  context: MetaLogContext,
  handler: () => Promise<T>,
): Promise<T> {
  return runWithMetaLogContextAsync(context, handler);
}

/**
 * Wraps a mutation route handler with AsyncLocalStorage context and
 * standardized error logging. Returns the handler result or a 500 JSON
 * response with correlationId when an unhandled error escapes.
 */
export async function withMetaMutationLogging<T>(
  options: WithMetaMutationLoggingOptions,
  handler: () => Promise<T>,
): Promise<T | NextResponse> {
  const correlationId = newCorrelationId();
  const context: MetaLogContext = {
    correlationId,
    app: options.app,
    route: options.route,
    actor: options.actor,
    operationHint: options.operationHint,
    entityHint: options.entityHint,
    parentIds: options.parentIds,
  };

  try {
    return await runWithMetaLogContextAsync(context, handler);
  } catch (error) {
    logMetaMutationError(error);
    return NextResponse.json(
      attachCorrelationId({
        success: false,
        error: "Internal Server Error",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      }),
      { status: 500 },
    );
  }
}
