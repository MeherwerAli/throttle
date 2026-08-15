import type { Request } from "express";

export interface SlidingWindowPolicy {
  strategy: "sliding-window";
  limit: number;
  windowMs: number;
}

export interface TokenBucketPolicy {
  strategy: "token-bucket";
  capacity: number;
  refillTokens: number;
  refillIntervalMs: number;
}

export type RateLimitPolicy = SlidingWindowPolicy | TokenBucketPolicy;

export interface StoreConsumeInput {
  policy: string;
  keyHash: string;
  cost: number;
  nowMs: number;
  definition: RateLimitPolicy;
}

export interface StoreDecision {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export interface RateLimitStore {
  consume(input: StoreConsumeInput): Promise<StoreDecision>;
}

export type RateLimitReason =
  | "allowed"
  | "quota_exceeded"
  | "store_error_allowed"
  | "store_error_denied";

export interface RateLimitDecision {
  allowed: boolean;
  degraded: boolean;
  policy: string;
  strategy: RateLimitPolicy["strategy"];
  limit: number;
  remaining: number | null;
  resetAtMs: number | null;
  retryAfterMs: number | null;
  reason: RateLimitReason;
  keyHash: string;
}

export interface LimiterInput {
  key: string;
  cost?: number;
}

export interface Limiter {
  consume(input: LimiterInput): Promise<RateLimitDecision>;
}

export interface DecisionEvent {
  decision: RateLimitDecision;
  durationMs: number;
}

interface BaseThrottleOptions {
  policy: string;
  store?: RateLimitStore;
  key?: (request: Request) => string | Promise<string>;
  cost?: number | ((request: Request) => number | Promise<number>);
  onStoreError?: "deny" | "allow";
  onDecision?: (event: DecisionEvent) => void | Promise<void>;
  allowInMemoryInProduction?: boolean;
}

export type ThrottleOptions = BaseThrottleOptions & RateLimitPolicy;
