import type { RateLimitDecision, RateLimitPolicy } from "./types.js";
import { advertisedWindowMs } from "./validation.js";

function seconds(milliseconds: number): number {
  return Math.max(0, Math.ceil(milliseconds / 1000));
}

// Kept isolated because draft-ietf-httpapi-ratelimit-headers-11 is a work in progress.
export function draft11Headers(
  decision: RateLimitDecision,
  definition: RateLimitPolicy,
  nowMs = Date.now(),
): Record<string, string> {
  const policy = `"${decision.policy}"`;
  const headers: Record<string, string> = {
    "RateLimit-Policy": `${policy};q=${decision.limit};w=${seconds(advertisedWindowMs(definition))}`,
  };
  if (decision.remaining !== null && decision.resetAtMs !== null) {
    headers.RateLimit = `${policy};r=${decision.remaining};t=${seconds(decision.resetAtMs - nowMs)}`;
  }
  return headers;
}
