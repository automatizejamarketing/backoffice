/**
 * Read-only Meta insights layer for the marketing chatbot.
 *
 * Thin wrappers over the existing `metaApiCall` (Graph API v25.0) with strong
 * defaults, internal pagination, currency/timezone handling, objective-aware
 * result extraction, and structured error envelopes — all the API mechanics the
 * model must not touch (design §1, §2). Consumed by the 5 tools factory.
 */
export * from "./envelope";
export * from "./currency";
export * from "./pagination";
export * from "./client";
export * from "./normalize";
export * from "./catalogs";
export * from "./account";
export * from "./objects";
export * from "./get-insights";
export * from "./entity";
export * from "./accounts";
