# Local measurement results

These files record reproducible observations from the uncommitted `codex/v0.1.0-implementation` snapshot on 2026-08-15. They are local engineering evidence, not an SLA, a production capacity claim, or release evidence. Repeat the measurements against the eventual tagged commit before quoting them in the portfolio.

## HTTP middleware benchmark

Apple M4 Pro host, Node.js 22.22.2, 100 warm-up requests, then 1,000 requests per scenario. Redis ran in Docker 8.2.8 through a loopback port mapping.

| Store | Concurrency | p50 | p95 | Throughput | Failure rate |
|---|---:|---:|---:|---:|---:|
| Memory | 1 | 0.141 ms | 0.231 ms | 6,297.280 req/s | 0% |
| Memory | 16 | 1.931 ms | 3.042 ms | 7,395.527 req/s | 0% |
| Memory | 64 | 5.746 ms | 20.561 ms | 7,078.479 req/s | 0% |
| Redis | 1 | 0.444 ms | 0.596 ms | 2,161.270 req/s | 0% |
| Redis | 16 | 2.131 ms | 3.299 ms | 6,976.221 req/s | 0% |
| Redis | 64 | 6.143 ms | 8.314 ms | 9,271.163 req/s | 0% |

The Redis run observed one namespaced hashed key with a 59,995 ms TTL and 3,100 atomic Lua `EVAL` calls, with zero rejected or failed calls. Loopback results do not predict cross-zone or managed-Redis latency.

## Compatibility evidence

- Node.js 22 host verification: typecheck, 13 deterministic tests, build, dry-run package, Redis integration tests, and fresh Express 4/5 consumers.
- Node.js 24.19.0 container verification: the same package boundary, three Redis integration tests, and fresh consumers on Express 4.21.2 and 5.2.1.
- The dry-run package contained 43 files and was approximately 12.6 kB packed / 43.4 kB unpacked.

## Raw evidence

- [`throttle-memory-local-2026-08-15.json`](./throttle-memory-local-2026-08-15.json)
- [`throttle-redis-local-2026-08-15.json`](./throttle-redis-local-2026-08-15.json)
- [`throttle-node24-compatibility-local-2026-08-15.json`](./throttle-node24-compatibility-local-2026-08-15.json)
