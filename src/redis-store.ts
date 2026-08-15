import { randomUUID } from "node:crypto";
import type { RateLimitStore, StoreConsumeInput, StoreDecision } from "./types.js";

export interface RedisClientLike {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

export interface RedisStoreOptions {
  prefix?: string;
}

const SLIDING_WINDOW_SCRIPT = `
local current = redis.call('TIME')
local now = current[1] * 1000 + math.floor(current[2] / 1000)
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local used = redis.call('ZCARD', KEYS[1])
local allowed = 0
if used + cost <= limit then
  allowed = 1
  for index = 1, cost do
    redis.call('ZADD', KEYS[1], now, member .. ':' .. index)
  end
  used = used + cost
end
redis.call('PEXPIRE', KEYS[1], window)
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local reset = now + window
if #oldest > 0 then reset = tonumber(oldest[2]) + window end
return {allowed, limit - used, tostring(reset)}
`;

const TOKEN_BUCKET_SCRIPT = `
local current = redis.call('TIME')
local now = current[1] * 1000 + math.floor(current[2] / 1000)
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local interval = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
local updated = tonumber(redis.call('HGET', KEYS[1], 'updated'))
if tokens == nil then tokens = capacity end
if updated == nil then updated = now end
local elapsed = math.max(0, now - updated)
local intervals = math.floor(elapsed / interval)
tokens = math.min(capacity, tokens + intervals * refill)
updated = updated + intervals * interval
local allowed = 0
if cost <= tokens then
  allowed = 1
  tokens = tokens - cost
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated', updated)
local lifetime = (math.ceil(capacity / refill) + 1) * interval
redis.call('PEXPIRE', KEYS[1], lifetime)
local deficit = math.max(0, cost - tokens)
local required = math.max(1, math.ceil(deficit / refill))
local reset = updated + required * interval
return {allowed, tostring(tokens), tostring(reset)}
`;

function parseDecision(value: unknown): StoreDecision {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError("Redis script returned an invalid decision");
  }
  const allowed = Number(value[0]) === 1;
  const remaining = Number(value[1]);
  const resetAtMs = Number(value[2]);
  if (!Number.isFinite(remaining) || !Number.isFinite(resetAtMs)) {
    throw new TypeError("Redis script returned non-numeric quota data");
  }
  return { allowed, remaining: Math.max(0, remaining), resetAtMs };
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly prefix: string;

  constructor(private readonly client: RedisClientLike, options: RedisStoreOptions = {}) {
    this.prefix = options.prefix ?? "throttle";
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(this.prefix)) {
      throw new TypeError("Redis prefix must contain 1-64 safe namespace characters");
    }
  }

  async consume(input: StoreConsumeInput): Promise<StoreDecision> {
    const key = `${this.prefix}:${input.policy}:${input.keyHash}`;
    if (input.definition.strategy === "sliding-window") {
      return parseDecision(await this.client.eval(SLIDING_WINDOW_SCRIPT, {
        keys: [key],
        arguments: [
          String(input.definition.limit),
          String(input.definition.windowMs),
          String(input.cost),
          randomUUID(),
        ],
      }));
    }
    return parseDecision(await this.client.eval(TOKEN_BUCKET_SCRIPT, {
      keys: [key],
      arguments: [
        String(input.definition.capacity),
        String(input.definition.refillTokens),
        String(input.definition.refillIntervalMs),
        String(input.cost),
      ],
    }));
  }
}

export function redisStore(client: RedisClientLike, options?: RedisStoreOptions): RateLimitStore {
  return new RedisRateLimitStore(client, options);
}
