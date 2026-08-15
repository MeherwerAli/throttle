import type { RateLimitPolicy, ThrottleOptions } from "./types.js";

const POLICY_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

export function validateOptions(options: ThrottleOptions): RateLimitPolicy {
  if (!POLICY_PATTERN.test(options.policy)) {
    throw new TypeError("policy must contain 1-64 letters, digits, dots, underscores, or hyphens");
  }

  if (options.strategy === "sliding-window") {
    positiveInteger(options.limit, "limit");
    positiveInteger(options.windowMs, "windowMs");
    return { strategy: options.strategy, limit: options.limit, windowMs: options.windowMs };
  }

  positiveInteger(options.capacity, "capacity");
  positiveInteger(options.refillTokens, "refillTokens");
  positiveInteger(options.refillIntervalMs, "refillIntervalMs");
  if (options.refillTokens > options.capacity) {
    throw new TypeError("refillTokens cannot exceed capacity");
  }
  return {
    strategy: options.strategy,
    capacity: options.capacity,
    refillTokens: options.refillTokens,
    refillIntervalMs: options.refillIntervalMs,
  };
}

export function validateCost(cost: number): number {
  positiveInteger(cost, "cost");
  return cost;
}

export function advertisedLimit(policy: RateLimitPolicy): number {
  return policy.strategy === "sliding-window" ? policy.limit : policy.capacity;
}

export function advertisedWindowMs(policy: RateLimitPolicy): number {
  if (policy.strategy === "sliding-window") {
    return policy.windowMs;
  }
  return Math.ceil(policy.capacity / policy.refillTokens) * policy.refillIntervalMs;
}
