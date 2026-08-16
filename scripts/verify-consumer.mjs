import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const expressVersion = process.argv[2] ?? "5.2.1";
const projectRoot = resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "throttle-consumer-"));

try {
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temporaryRoot], {
    cwd: projectRoot,
    encoding: "utf8",
  }));
  const tarball = join(temporaryRoot, packed[0].filename);
  const consumer = join(temporaryRoot, "consumer");
  await writeFile(join(temporaryRoot, ".keep"), "", "utf8");
  execFileSync("mkdir", ["-p", consumer]);
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({
    private: true,
    type: "module",
    dependencies: {
      "@meherwer_ali/throttle": `file:${tarball}`,
      express: expressVersion,
      redis: "6.2.1",
      typescript: "7.0.2",
      "@types/express": "5.0.3",
      "@types/node": "24.3.0",
    },
  }, null, 2)}\n`, "utf8");
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: consumer,
    stdio: "inherit",
  });
  await writeFile(join(consumer, "index.mjs"), `
import assert from "node:assert/strict";
import express from "express";
import { createLimiter, throttle } from "@meherwer_ali/throttle";
import { redisStore } from "@meherwer_ali/throttle/redis";

assert.equal(typeof express, "function");
assert.equal(typeof throttle, "function");
const limiter = createLimiter({ policy: "consumer", strategy: "sliding-window", limit: 1, windowMs: 1000 });
assert.equal((await limiter.consume({ key: "client" })).allowed, true);
const fakeRedis = { async eval() { return [1, "0", String(Date.now() + 1000)]; } };
const distributed = createLimiter({ policy: "redis", strategy: "sliding-window", limit: 1, windowMs: 1000, store: redisStore(fakeRedis) });
assert.equal((await distributed.consume({ key: "client" })).allowed, true);
`, "utf8");
  await writeFile(join(consumer, "types.ts"), `
import type { ThrottleOptions, RateLimitStore } from "@meherwer_ali/throttle";
import type { RedisClientLike } from "@meherwer_ali/throttle/redis";
declare const store: RateLimitStore;
declare const client: RedisClientLike;
const options: ThrottleOptions = { policy: "typed", strategy: "sliding-window", limit: 10, windowMs: 1000, store };
void options;
void client;
`, "utf8");
  execFileSync(process.execPath, [join(consumer, "index.mjs")], { stdio: "inherit" });
  execFileSync(join(consumer, "node_modules", ".bin", "tsc"), [
    "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "types.ts",
  ], { cwd: consumer, stdio: "inherit" });
  const manifest = JSON.parse(await readFile(join(consumer, "node_modules", "@meherwer_ali", "throttle", "package.json"), "utf8"));
  process.stdout.write(`consumer-ok express=${expressVersion} package=${manifest.version} tarball=${basename(tarball)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
