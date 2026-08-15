import type { RateLimitStore, StoreConsumeInput, StoreDecision } from "./types.js";

interface SlidingEntry {
  atMs: number;
  cost: number;
}

interface BucketEntry {
  tokens: number;
  updatedAtMs: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly sliding = new Map<string, SlidingEntry[]>();
  private readonly buckets = new Map<string, BucketEntry>();

  async consume(input: StoreConsumeInput): Promise<StoreDecision> {
    const storageKey = `${input.policy}:${input.keyHash}`;
    if (input.definition.strategy === "sliding-window") {
      return this.consumeSliding(storageKey, input);
    }
    return this.consumeBucket(storageKey, input);
  }

  private consumeSliding(storageKey: string, input: StoreConsumeInput): StoreDecision {
    if (input.definition.strategy !== "sliding-window") {
      throw new TypeError("invalid sliding-window input");
    }
    const cutoff = input.nowMs - input.definition.windowMs;
    const entries = (this.sliding.get(storageKey) ?? []).filter((entry) => entry.atMs > cutoff);
    const used = entries.reduce((total, entry) => total + entry.cost, 0);
    const allowed = used + input.cost <= input.definition.limit;
    if (allowed) {
      entries.push({ atMs: input.nowMs, cost: input.cost });
    }
    if (entries.length === 0) {
      this.sliding.delete(storageKey);
    } else {
      this.sliding.set(storageKey, entries);
    }
    const remaining = Math.max(0, input.definition.limit - used - (allowed ? input.cost : 0));
    const oldest = entries[0]?.atMs ?? input.nowMs;
    return { allowed, remaining, resetAtMs: oldest + input.definition.windowMs };
  }

  private consumeBucket(storageKey: string, input: StoreConsumeInput): StoreDecision {
    if (input.definition.strategy !== "token-bucket") {
      throw new TypeError("invalid token-bucket input");
    }
    const existing = this.buckets.get(storageKey) ?? {
      tokens: input.definition.capacity,
      updatedAtMs: input.nowMs,
    };
    const elapsed = Math.max(0, input.nowMs - existing.updatedAtMs);
    const intervals = Math.floor(elapsed / input.definition.refillIntervalMs);
    const tokens = Math.min(
      input.definition.capacity,
      existing.tokens + intervals * input.definition.refillTokens,
    );
    const updatedAtMs = existing.updatedAtMs + intervals * input.definition.refillIntervalMs;
    const allowed = input.cost <= tokens;
    const remaining = allowed ? tokens - input.cost : tokens;
    this.buckets.set(storageKey, { tokens: remaining, updatedAtMs });

    const deficit = Math.max(0, input.cost - remaining);
    const intervalsNeeded = Math.max(1, Math.ceil(deficit / input.definition.refillTokens));
    const resetAtMs = updatedAtMs + intervalsNeeded * input.definition.refillIntervalMs;
    return { allowed, remaining, resetAtMs };
  }
}
