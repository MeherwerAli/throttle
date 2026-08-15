# Throttle

Throttle is a small Express admission-control library with exact sliding-window and token-bucket strategies. Its focus is explicit distributed failure behavior: Redis operations are atomic, client identifiers are hashed before storage, and a store outage never silently changes a multi-pod policy into independent per-process quotas.

```ts
import express from "express";
import { createClient } from "redis";
import { throttle } from "@meherwerali/throttle";
import { redisStore } from "@meherwerali/throttle/redis";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const app = express();
app.use(throttle({
  strategy: "sliding-window",
  limit: 100,
  windowMs: 60_000,
  store: redisStore(redis),
  policy: "public-api",
  key: (request) => request.user?.id ?? request.ip,
}));
```

## Behavior

- Node.js 22+, ESM, TypeScript 7, Express 4.18 through 5.x
- Redis 6.x integration exported separately from `@meherwerali/throttle/redis`
- atomic Redis Lua scripts using Redis server time
- in-process memory store for development and intentional single-process use
- construction fails in production without a shared store unless `allowInMemoryInProduction: true`
- store failures deny with HTTP 503 by default; explicit `onStoreError: "allow"` continues with a degraded decision event
- HTTP 429 uses `application/problem+json`, `Retry-After`, `RateLimit`, and `RateLimit-Policy`
- `onDecision` supports application-owned logs and metrics without adding a telemetry runtime

The `RateLimit` serializer is isolated because [draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) remains a work in progress.

## Token bucket

```ts
app.use(throttle({
  policy: "generation",
  strategy: "token-bucket",
  capacity: 200,
  refillTokens: 20,
  refillIntervalMs: 1_000,
  cost: async (request) => Number(request.header("x-request-cost") ?? 1),
  store: redisStore(redis),
}));
```

Refills occur in discrete intervals. Costs are positive safe integers. A cost above the available bucket is denied without consuming tokens.

## Proxy boundary

The default partition key is `request.ip`. Throttle does not enable Express proxy trust. Configure [`trust proxy`](https://expressjs.com/en/5x/guide/behind-proxies.html) narrowly in the host application only when every trusted hop overwrites forwarded-address headers. Otherwise an attacker may select the apparent client address.

## Failure policy

```ts
app.use(throttle({
  policy: "best-effort",
  strategy: "sliding-window",
  limit: 100,
  windowMs: 60_000,
  store: redisStore(redis),
  onStoreError: "allow",
  onDecision: ({ decision, durationMs }) => {
    metrics.record(decision.reason, durationMs);
  },
}));
```

Fail-open is a deliberate availability trade-off and emits `RateLimit-Degraded: store-unavailable`. Throttle never falls back from Redis to memory during an outage.

## Verification

```bash
npm ci
npm run verify
docker compose up -d --wait redis
REDIS_URL=redis://127.0.0.1:6379 npm run test:redis
npm run build
npm run test:consumer -- 5.2.1
```

The consumer check packs the library, installs it into a fresh temporary ESM project, type-checks the public API, and exercises both root and Redis subpath exports. See [architecture](docs/ARCHITECTURE.md), [threats and limitations](docs/THREAT-LIMITATIONS.md), [demo](docs/DEMO.md), [measurement procedure](reports/README.md), and [local measurement results](reports/results/README.md).

Circuit breaking is intentionally outside v0.1. A future breaker will wrap outbound asynchronous dependency actions; incoming Express responses are not enough to infer dependency health safely.

## License

MIT
