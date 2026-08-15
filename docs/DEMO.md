# Two-minute demo

1. Start Redis with `docker compose up -d --wait redis` and run the Redis integration test.
2. Show the one-line Express middleware and the separate Redis import.
3. Send one admitted request and one request that returns the 429 problem document and draft-11 headers.
4. Stop Redis: show the default 503 failure, then change to explicit `onStoreError: "allow"` and show the degraded header/event.
5. Run `npm run build` and `npm run test:consumer -- 4.21.2` to demonstrate the packed ESM/types boundary on Express 4.

Do not present unpublished benchmark output or imply that a local Redis run represents a production network topology.
