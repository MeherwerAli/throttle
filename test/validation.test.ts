import { describe, expect, it } from "vitest";
import { createLimiter } from "../src/index.js";

describe("configuration validation", () => {
  it("rejects unsafe policy namespaces", () => {
    expect(() => createLimiter({
      policy: "unsafe policy",
      strategy: "sliding-window",
      limit: 1,
      windowMs: 1_000,
    })).toThrow(/policy/);
  });

  it("rejects a refill larger than bucket capacity", () => {
    expect(() => createLimiter({
      policy: "api",
      strategy: "token-bucket",
      capacity: 2,
      refillTokens: 3,
      refillIntervalMs: 1_000,
    })).toThrow(/refillTokens/);
  });

  it("rejects unsafe request costs", async () => {
    const limiter = createLimiter({
      policy: "api",
      strategy: "sliding-window",
      limit: 10,
      windowMs: 1_000,
    });
    await expect(limiter.consume({ key: "client", cost: 0 })).rejects.toThrow(/cost/);
  });
});
