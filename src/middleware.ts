import type { NextFunction, Request, RequestHandler, Response } from "express";
import { draft11Headers } from "./headers.js";
import { createLimiter } from "./limiter.js";
import type { ThrottleOptions } from "./types.js";
import { validateCost, validateOptions } from "./validation.js";

function sendProblem(response: Response, status: number, body: Record<string, unknown>): void {
  response.status(status).type("application/problem+json").json(body);
}

export function throttle(options: ThrottleOptions): RequestHandler {
  const definition = validateOptions(options);
  const limiter = createLimiter(options);
  const key = options.key ?? ((request: Request) => request.ip ?? "unknown");

  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const resolvedCost = typeof options.cost === "function" ? await options.cost(request) : (options.cost ?? 1);
      const decision = await limiter.consume({ key: await key(request), cost: validateCost(resolvedCost) });
      for (const [name, value] of Object.entries(draft11Headers(decision, definition))) {
        response.setHeader(name, value);
      }

      if (decision.allowed) {
        if (decision.degraded) response.setHeader("RateLimit-Degraded", "store-unavailable");
        next();
        return;
      }

      if (decision.reason === "store_error_denied") {
        sendProblem(response, 503, {
          type: "https://iana.org/assignments/http-problem-types#temporary-reduced-capacity",
          title: "Rate-limit store is unavailable",
          status: 503,
          "violated-policies": [options.policy],
        });
        return;
      }

      response.setHeader("Retry-After", String(Math.max(1, Math.ceil((decision.retryAfterMs ?? 1) / 1000))));
      sendProblem(response, 429, {
        type: "https://iana.org/assignments/http-problem-types#quota-exceeded",
        title: "Request quota has been exceeded",
        status: 429,
        "violated-policies": [options.policy],
      });
    } catch (error) {
      next(error);
    }
  };
}
