import { AsyncLocalStorage } from "node:async_hooks";

export type MetaLogActor =
  | {
      kind: "frontend";
      userId: string;
      email?: string | null;
    }
  | {
      kind: "backoffice";
      id: string;
      email: string;
      role: string;
      targetUserId: string;
    };

export type MetaLogContext = {
  correlationId: string;
  app: "automatize-frontend" | "backoffice";
  route: string;
  actor?: MetaLogActor;
  operationHint?: string;
  entityHint?: string;
  parentIds?: {
    adAccountId?: string;
    campaignId?: string;
    adSetId?: string;
    adId?: string;
  };
};

const storage = new AsyncLocalStorage<MetaLogContext>();

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function getMetaLogContext(): MetaLogContext | undefined {
  return storage.getStore();
}

export function runWithMetaLogContext<T>(
  context: MetaLogContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

export async function runWithMetaLogContextAsync<T>(
  context: MetaLogContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

/**
 * Sets mutation-log context for the current request without wrapping the handler.
 * Prefer this at the top of API route handlers so all downstream Meta calls inherit context.
 */
export function enterMetaMutationLog(
  options: Omit<MetaLogContext, "correlationId">,
): MetaLogContext {
  const context: MetaLogContext = {
    correlationId: newCorrelationId(),
    ...options,
  };
  storage.enterWith(context);
  return context;
}

/** Merges actor/parentIds into the active mutation-log context (after auth). */
export function updateMetaMutationContext(
  patch: Partial<Pick<MetaLogContext, "actor" | "parentIds" | "operationHint" | "entityHint">>,
): void {
  const current = storage.getStore();
  if (!current) return;
  storage.enterWith({ ...current, ...patch });
}
