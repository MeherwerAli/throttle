import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLimiter, hashClientKey, type RateLimitStore } from "../src/index.js";

describe("limiter algorithms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NODE_ENV;
  });

  it("enforces the exact sliding-window boundary and request cost", async () => {
    const limiter = createLimiter({
      policy: "api",
      strategy: "sliding-window",
      limit: 3,
      windowMs: 1_000,
    });

    expect((await limiter.consume({ key: "client", cost: 2 })).allowed).toBe(true);
    const rejected = await limiter.consume({ key: "client", cost: 2 });
    expect(rejected).toMatchObject({ allowed: false, remaining: 1, retryAfterMs: 1_000 });

    vi.advanceTimersByTime(1_000);
    expect((await limiter.consume({ key: "client", cost: 3 })).allowed).toBe(true);
  });

  it("refills a token bucket in discrete intervals", async () => {
    const limiter = createLimiter({
      policy: "uploads",
      strategy: "token-bucket",
      capacity: 3,
      refillTokens: 1,
      refillIntervalMs: 1_000,
    });

    expect((await limiter.consume({ key: "client", cost: 2 })).remaining).toBe(1);
    expect((await limiter.consume({ key: "client", cost: 2 })).allowed).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(await limiter.consume({ key: "client", cost: 2 })).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("hashes client identifiers before invoking a store", async () => {
    let observedKey = "";
    const store: RateLimitStore = {
      async consume(input) {
        observedKey = input.keyHash;
        return { allowed: true, remaining: 9, resetAtMs: input.nowMs + 1_000 };
      },
    };
    const limiter = createLimiter({
      policy: "public-api",
      strategy: "sliding-window",
      limit: 10,
      windowMs: 1_000,
      store,
    });

    await limiter.consume({ key: "user@example.test" });
    expect(observedKey).toBe(hashClientKey("user@example.test"));
    expect(observedKey).not.toContain("user@example.test");
  });

  it("requires an intentional store choice in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => createLimiter({
      policy: "api",
      strategy: "sliding-window",
      limit: 1,
      windowMs: 1_000,
    })).toThrow(/shared RateLimitStore/);
  });

  it("does not allow instrumentation failures to change a decision", async () => {
    const limiter = createLimiter({
      policy: "api",
      strategy: "sliding-window",
      limit: 1,
      windowMs: 1_000,
      onDecision: () => {
        throw new Error("telemetry offline");
      },
    });

    expect((await limiter.consume({ key: "client" })).allowed).toBe(true);
  });
});
