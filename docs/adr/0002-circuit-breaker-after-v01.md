# ADR 0002: Circuit breaking is separate from v0.1 admission control

Status: accepted.

## Decision

v0.1 limits incoming Express work only. A later circuit-breaker API will wrap an explicit outbound asynchronous action with closed, open, and half-open states.

## Consequences

The limiter does not guess dependency health from arbitrary HTTP response status codes. The future breaker can define its own sampling window, error classifier, state distribution, and probe concurrency without coupling those semantics to quota accounting.
