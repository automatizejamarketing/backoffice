/**
 * Simple in-memory fixed-window limiter for backoffice expensive routes.
 * Matches the META_AI_CAMPAIGN spirit from the frontend (15 / 60s).
 */

export type RateLimitConfig = {
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export const RATE_LIMITS = {
  META_AI_CAMPAIGN: { limit: 15, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitConfig>;

type MemoryBucket = {
  count: number;
  resetAtMs: number;
};

const memoryBuckets = new Map<string, MemoryBucket>();

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const existing = memoryBuckets.get(key);

  if (!existing || existing.resetAtMs <= now) {
    memoryBuckets.set(key, {
      count: 1,
      resetAtMs: now + config.windowSeconds * 1000,
    });
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      retryAfterSeconds: config.windowSeconds,
    };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAtMs - now) / 1000),
  );

  if (existing.count > config.limit) {
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  return {
    success: true,
    limit: config.limit,
    remaining: Math.max(0, config.limit - existing.count),
    retryAfterSeconds,
  };
}
