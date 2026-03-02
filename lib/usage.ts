import type { LanguageModelUsage } from "ai";

// Simplified AppUsage type for backoffice (without tokenlens dependency)
// Server-merged usage: base usage + optional modelId
export type AppUsage = LanguageModelUsage & { modelId?: string };
