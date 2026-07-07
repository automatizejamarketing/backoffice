/**
 * Unified Meta UPDATE surface (ADR 0010) — the single edit entry point reused by
 * the marketing UI routes and the AI assistant, sibling of ./creation. See
 * ./update-campaign, ./update-ad-set, ./update-ad, ./migrate-budget-mode.
 */

export * from "./types";
export * from "./read-current";
export * from "./ownership";
export * from "./validation";
export * from "./update-campaign";
export * from "./update-ad-set";
export * from "./update-ad";
export * from "./migrate-budget-mode";
