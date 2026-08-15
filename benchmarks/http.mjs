import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cpus, platform, release, totalmem } from "node:os";
import express from "express";
import { throttle } from "../dist/index.js";

const storeMode = process.env.STORE ?? "memory";
const output = resolve(process.argv[2] ?? `reports/raw/${storeMode}-latest.json`);
const requestsPerScenario = Number.parseInt(process.env.REQUESTS_PER_SCENARIO ?? "1000", 10);
const warmupRequests = Number.parseInt(process.env.WARMUP_REQUESTS ?? "100", 10);
const concurrencies = [1, 16, 64];
let store;
let redis;
let redisVersion = null;

if (!Number.isInteger(requestsPerScenario) || requestsPerScenario < 1) {
  throw new Error("REQUESTS_PER_SCENARIO must be a positive integer");
}
if (!Number.isInteger(warmupRequests) || warmupRequests < 0) {
  throw new Error("WARMUP_REQUESTS must be a non-negative integer");
}

if (storeMode === "redis") {
  const [{ createClient }, { redisStore }] = await Promise.all([import("redis"), import("../dist/redis.js")]);
  redis = createClient({ url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" });
  await redis.connect();
  const staleBenchmarkKeys = await redis.keys("throttle-benchmark:*");
  if (staleBenchmarkKeys.length > 0) await redis.del(staleBenchmarkKeys);
  await redis.sendCommand(["CONFIG", "RESETSTAT"]);
  const serverInfo = await redis.info("server");
  redisVersion = /^redis_version:([^\r\n]+)$/m.exec(serverInfo)?.[1] ?? "unknown";
  store = redisStore(redis, { prefix: "throttle-benchmark" });
} else if (storeMode !== "memory") {
  throw new Error("STORE must be memory or redis");
}

function percentile(sorted, quantile) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

const app = express();
app.use(throttle({
  policy: "benchmark",
  strategy: "sliding-window",
  limit: 100_000_000,
  windowMs: 60_000,
  key: () => "benchmark-client",
  ...(store ? { store } : {}),
}));
app.get("/", (_request, response) => response.sendStatus(204));
const server = createServer(app);
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (!address || typeof address === "string") throw new Error("benchmark server did not bind TCP");
const url = `http://127.0.0.1:${address.port}/`;

async function scenario(concurrency) {
  let issued = 0;
  let failures = 0;
  const latencies = [];
  const started = performance.now();
  async function worker() {
    while (issued < requestsPerScenario) {
      issued += 1;
      const requestStarted = performance.now();
      try {
        const response = await fetch(url);
        if (response.status !== 204) failures += 1;
        await response.arrayBuffer();
      } catch {
        failures += 1;
      }
      latencies.push(performance.now() - requestStarted);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - started;
  latencies.sort((left, right) => left - right);
  return {
    concurrency,
    requests: requestsPerScenario,
    p50LatencyMs: Number(percentile(latencies, 0.5).toFixed(3)),
    p95LatencyMs: Number(percentile(latencies, 0.95).toFixed(3)),
    throughputRequestsPerSecond: Number(((requestsPerScenario * 1000) / elapsedMs).toFixed(3)),
    failureRate: Number((failures / requestsPerScenario).toFixed(5)),
  };
}

try {
  for (let index = 0; index < warmupRequests; index += 1) {
    const response = await fetch(url);
    if (response.status !== 204) throw new Error(`warm-up request returned ${response.status}`);
    await response.arrayBuffer();
  }
  const scenarios = [];
  for (const concurrency of concurrencies) scenarios.push(await scenario(concurrency));
  const redisKeys = redis ? await redis.keys("throttle-benchmark:*") : [];
  const redisCommandStats = redis ? await redis.info("commandstats") : "";
  const report = {
    generatedAt: new Date().toISOString(),
    snapshot: process.env.BENCHMARK_SNAPSHOT ?? "uncommitted-local-snapshot",
    environment: {
      node: process.version,
      platform: `${platform()}-${process.arch}`,
      osRelease: release(),
      cpu: cpus()[0]?.model ?? "unknown",
      hostMemoryBytes: totalmem(),
      redisVersion,
    },
    store: storeMode,
    topology: storeMode === "redis"
      ? "host Express process to Docker Redis through a loopback port mapping"
      : "single host process with in-memory state",
    warmup: { requests: warmupRequests, policy: "sequential requests before timed scenarios" },
    redisOperations: storeMode === "redis" ? {
      operation: "one atomic EVAL per admission decision",
      keyCount: redisKeys.length,
      keyTtlMs: redisKeys[0] ? await redis.pTTL(redisKeys[0]) : null,
      evalCommandStats: /^cmdstat_eval:([^\r\n]+)$/m.exec(redisCommandStats)?.[1] ?? "not-reported",
    } : "not applicable",
    scenarios,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
} finally {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (redis?.isOpen) await redis.quit();
}
