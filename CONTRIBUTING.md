# Contributing

Use Node.js 22 or 24. Keep the root package free of runtime dependencies and keep Redis support behind the `/redis` export. New strategies must define exact boundary, cost, TTL, concurrent-store, and store-outage tests.

```bash
npm ci
npm run verify
docker compose up -d --wait redis
REDIS_URL=redis://127.0.0.1:6379 npm run test:redis
```

Good first contributions include a header-parser interop fixture, property-based boundary tests, or another store adapter with documented consistency semantics. Circuit breaking belongs to the v0.2 design boundary and should not be added as an Express response observer.
