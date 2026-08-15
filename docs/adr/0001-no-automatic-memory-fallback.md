# ADR 0001: No automatic memory fallback

Status: accepted for v0.1.

## Decision

When a configured shared store fails, return 503 by default or follow the caller's explicit fail-open choice. Never replace Redis with a memory store automatically.

## Consequences

Multi-pod quotas cannot silently split into independent counters. Operators must choose whether availability or enforcement wins during the outage, and telemetry can identify that choice. Fail-closed can reject otherwise valid traffic; fail-open can exceed a quota.
