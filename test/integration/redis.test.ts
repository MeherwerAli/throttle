import express from "express";
import { createClient } from "redis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { throttle } from "../../src/index.js";
import { redisStore } from "../../src/redis.js";

const configuredRedisUrl = process.env.REDIS_URL;
const redisUrl = configuredRedisUrl ?? "redis://127.0.0.1:6379";
const redisSuite = configuredRedisUrl ? describe : describe.skip;

redisSuite("Redis integration", () => {
  const firstClient = createClient({ url: redisUrl });
  const secondClient = createClient({ url: redisUrl });

  beforeAll(async () => {
    await Promise.all([firstClient.connect(), secondClient.connect()]);
    await firstClient.flushDb();
  });

  afterAll(async () => {
    if (firstClient.isOpen) await firstClient.quit();
    if (secondClient.isOpen) await secondClient.quit();
  });

  it("admits exactly 100 of 200 concurrent requests across two Express instances", async () => {
    const options = {
      policy: "distributed",
      strategy: "sliding-window" as const,
      limit: 100,
      windowMs: 60_000,
      key: async () => "shared-client",
    };
    const first = express().use(throttle({ ...options, store: redisStore(firstClient) })).get("/", (_req, res) => res.sendStatus(200));
    const second = express().use(throttle({ ...options, store: redisStore(secondClient) })).get("/", (_req, res) => res.sendStatus(200));

    const responses = await Promise.all(Array.from({ length: 200 }, (_, index) =>
      request(index % 2 === 0 ? first : second).get("/")));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(100);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(100);

    const keys = await firstClient.keys("throttle:distributed:*");
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("shared-client");
    expect(await firstClient.pTTL(keys[0]!)).toBeGreaterThan(0);
  });

  it("shares token-bucket request costs", async () => {
    await firstClient.flushDb();
    const store = redisStore(firstClient);
    const app = express().use(throttle({
      policy: "weighted",
      strategy: "token-bucket",
      capacity: 5,
      refillTokens: 1,
      refillIntervalMs: 60_000,
      cost: 3,
      key: () => "shared-client",
      store,
    })).get("/", (_req, res) => res.sendStatus(200));

    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(429);
  });

  it("applies explicit deny and allow policies when a Redis client is closed", async () => {
    const closedClient = createClient({ url: redisUrl });
    await closedClient.connect();
    await closedClient.quit();
    const common = {
      policy: "outage",
      strategy: "sliding-window" as const,
      limit: 10,
      windowMs: 1_000,
      store: redisStore(closedClient),
    };

    const denied = express().use(throttle(common)).get("/", (_req, res) => res.sendStatus(200));
    const allowed = express().use(throttle({ ...common, onStoreError: "allow" })).get("/", (_req, res) => res.sendStatus(200));

    expect((await request(denied).get("/")).status).toBe(503);
    const allowedResponse = await request(allowed).get("/");
    expect(allowedResponse.status).toBe(200);
    expect(allowedResponse.headers["ratelimit-degraded"]).toBe("store-unavailable");
  });
});
