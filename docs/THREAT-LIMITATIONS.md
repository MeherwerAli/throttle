# Threats and limitations

| Boundary | Mitigation | Residual limitation |
| --- | --- | --- |
| Client identity | SHA-256 before store; safe policy namespace | Key quality is owned by the host application; hashing is not authentication |
| Forwarded addresses | Default uses Express `request.ip` without enabling proxy trust | A broad host `trust proxy` configuration permits address spoofing |
| Concurrent pods | Atomic Redis scripts and Redis server time | Memory mode is process-local and cannot enforce a distributed quota |
| Redis outage | Default deny with 503; explicit allow emits degraded state | Fail-closed reduces availability; fail-open suspends enforcement |
| Key growth | Sliding-window and bucket TTLs | Adversaries can still create many partitions during the retention window |
| Header disclosure | Hashed key is not emitted in headers | Policy names and current quota reveal capacity hints by design |
| Instrumentation | Hook failures are isolated | The application must monitor dropped or failing telemetry itself |

Throttle is admission control, not authentication, authorization, DDoS scrubbing, concurrency limiting, or a circuit breaker. A remote attacker can still consume network and parsing resources before middleware executes. Place edge controls in front of the application for volumetric threats.

Lua scripts are atomic on a single Redis primary. Cross-region active-active Redis products can have different consistency semantics and require product-specific validation. Redis Cluster users must keep each policy-partition decision on one key, which this implementation does.
