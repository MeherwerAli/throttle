# Measurement procedure

The harness records raw HTTP overhead at concurrency 1, 16, and 64. Results are evidence for the disclosed local environment only; they are not an SLA or a prediction for another Redis topology.

```bash
npm ci
npm run build
REQUESTS_PER_SCENARIO=1000 node benchmarks/http.mjs reports/raw/memory.json

docker compose up -d --wait redis
STORE=redis REDIS_URL=redis://127.0.0.1:6379 \
  REQUESTS_PER_SCENARIO=1000 node benchmarks/http.mjs reports/raw/redis.json
```

Keep each published report with the code commit, Node and Redis versions, CPU/memory, operating system, request count, network topology, warm-up policy, p50/p95 latency, throughput, and failure rate. Redis mode performs one atomic Lua `EVAL` per decision; inspect Redis server metrics separately for CPU, memory, rejected connections, and command latency.

`reports/raw/` is ignored during implementation. Curated local evidence belongs in `reports/results/`; a release report must still be reviewed before any portfolio metric is quoted.

The current uncommitted local observations are summarized in [`reports/results/README.md`](results/README.md).
