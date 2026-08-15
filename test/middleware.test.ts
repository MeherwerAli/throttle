import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { throttle, type RateLimitStore } from "../src/index.js";

function application(middleware: express.RequestHandler, trustProxy?: string) {
  const app = express();
  if (trustProxy) app.set("trust proxy", trustProxy);
  app.use(middleware);
  app.get("/", (_request, response) => response.json({ ok: true }));
  return app;
}

describe("Express middleware", () => {
  it("returns draft-11 headers and a quota-exceeded problem", async () => {
    const app = application(throttle({
      policy: "public-api",
      strategy: "sliding-window",
      limit: 1,
      windowMs: 60_000,
    }));

    const admitted = await request(app).get("/");
    expect(admitted.status).toBe(200);
    expect(admitted.headers.ratelimit).toMatch(/^"public-api";r=0;t=/);
    expect(admitted.headers["ratelimit-policy"]).toBe('"public-api";q=1;w=60');

    const rejected = await request(app).get("/");
    expect(rejected.status).toBe(429);
    expect(rejected.type).toBe("application/problem+json");
    expect(rejected.headers["retry-after"]).toBe("60");
    expect(rejected.body).toMatchObject({
      type: "https://iana.org/assignments/http-problem-types#quota-exceeded",
      status: 429,
      "violated-policies": ["public-api"],
    });
  });

  it("ignores spoofed forwarded addresses until the host enables proxy trust", async () => {
    const options = {
      policy: "proxy-test",
      strategy: "sliding-window" as const,
      limit: 1,
      windowMs: 60_000,
    };
    const untrusted = application(throttle(options));
    expect((await request(untrusted).get("/").set("X-Forwarded-For", "198.51.100.1")).status).toBe(200);
    expect((await request(untrusted).get("/").set("X-Forwarded-For", "198.51.100.2")).status).toBe(429);

    const trusted = application(throttle(options), "loopback");
    expect((await request(trusted).get("/").set("X-Forwarded-For", "198.51.100.1")).status).toBe(200);
    expect((await request(trusted).get("/").set("X-Forwarded-For", "198.51.100.2")).status).toBe(200);
  });

  it("denies on store failure by default", async () => {
    const store: RateLimitStore = {
      async consume() {
        throw new Error("Redis timeout");
      },
    };
    const response = await request(application(throttle({
      policy: "api",
      strategy: "sliding-window",
      limit: 10,
      windowMs: 1_000,
      store,
    }))).get("/");

    expect(response.status).toBe(503);
    expect(response.type).toBe("application/problem+json");
    expect(response.headers["ratelimit-degraded"]).toBeUndefined();
  });

  it("allows explicitly and emits degraded state on store failure", async () => {
    const store: RateLimitStore = {
      async consume() {
        throw new Error("Redis timeout");
      },
    };
    const response = await request(application(throttle({
      policy: "api",
      strategy: "token-bucket",
      capacity: 10,
      refillTokens: 1,
      refillIntervalMs: 1_000,
      store,
      onStoreError: "allow",
    }))).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["ratelimit-degraded"]).toBe("store-unavailable");
    expect(response.headers.ratelimit).toBeUndefined();
  });

  it("supports asynchronous client keys and costs", async () => {
    const app = application(throttle({
      policy: "weighted",
      strategy: "sliding-window",
      limit: 3,
      windowMs: 60_000,
      key: async (incoming) => String(incoming.header("x-client")),
      cost: async () => 2,
    }));

    expect((await request(app).get("/").set("X-Client", "one")).status).toBe(200);
    expect((await request(app).get("/").set("X-Client", "one")).status).toBe(429);
    expect((await request(app).get("/").set("X-Client", "two")).status).toBe(200);
  });
});
