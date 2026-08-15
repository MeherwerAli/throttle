import { performance } from "node:perf_hooks";
import { hashClientKey } from "./hash.js";
import { MemoryRateLimitStore } from "./memory-store.js";
import type {
  DecisionEvent,
  Limiter,
  LimiterInput,
  RateLimitDecision,
  RateLimitStore,
  ThrottleOptions,
} from "./types.js";
import { advertisedLimit, validateCost, validateOptions } from "./validation.js";

async function emit(hook: ThrottleOptions["onDecision"], event: DecisionEvent): Promise<void> {
  if (!hook) return;
  try {
    await hook(event);
  } catch {
    // Instrumentation is observational and must not change admission decisions.
  }
}

function resolveStore(options: ThrottleOptions): RateLimitStore {
  if (options.store) return options.store;
  if (process.env.NODE_ENV === "production" && options.allowInMemoryInProduction !== true) {
    throw new Error(
      "A shared RateLimitStore is required in production; set allowInMemoryInProduction only for an intentional single-process policy",
    );
  }
  return new MemoryRateLimitStore();
}

export function createLimiter(options: ThrottleOptions): Limiter {
  const definition = validateOptions(options);
  const store = resolveStore(options);
  const onStoreError = options.onStoreError ?? "deny";
  const limit = advertisedLimit(definition);

  return {
    async consume(input: LimiterInput): Promise<RateLimitDecision> {
      const started = performance.now();
      const keyHash = hashClientKey(input.key);
      const cost = validateCost(input.cost ?? 1);
      const nowMs = Date.now();
      let decision: RateLimitDecision;
      try {
        const result = await store.consume({
          policy: options.policy,
          keyHash,
          cost,
          nowMs,
          definition,
        });
        decision = {
          allowed: result.allowed,
          degraded: false,
          policy: options.policy,
          strategy: definition.strategy,
          limit,
          remaining: Math.max(0, Math.floor(result.remaining)),
          resetAtMs: result.resetAtMs,
          retryAfterMs: result.allowed ? null : Math.max(1, result.resetAtMs - nowMs),
          reason: result.allowed ? "allowed" : "quota_exceeded",
          keyHash,
        };
      } catch {
        const allowed = onStoreError === "allow";
        decision = {
          allowed,
          degraded: true,
          policy: options.policy,
          strategy: definition.strategy,
          limit,
          remaining: null,
          resetAtMs: null,
          retryAfterMs: null,
          reason: allowed ? "store_error_allowed" : "store_error_denied",
          keyHash,
        };
      }
      await emit(options.onDecision, { decision, durationMs: performance.now() - started });
      return decision;
    },
  };
}
