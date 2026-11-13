# BIDHUB — Operations and acceptance (planned)

## Implemented baseline

See root README to start web/API/database. Liveness checks process; readiness checks DB connection. Local DB is bound to loopback. No production server is provisioned by this scaffold.

## Deployment ownership: Bảo

1. Select an agreed Linux host and budget; record CPU/RAM/OS/location.
2. Build web and API from the exact tested commit; pin dependency lockfile. API container entry/config must bind internally to 0.0.0.0 (local bootstrap currently binds 127.0.0.1).
3. Run PostgreSQL on private Docker network, no public database port; unique secret password and persistent volume. Configure API DATABASE_URL to db service name, not localhost.
4. Nginx serves web assets; SPA fallback to index.html; proxies /api and /socket.io with HTTP/1.1 Upgrade/Connection headers, appropriate timeouts and exact origin.
5. Configure DNS and valid TLS certificate; port 80 redirects to 443, SSH restricted. Secure session cookies in HTTPS; do not log headers/cookies.
6. Run versioned DB migration as a release step and readiness check before traffic. Test 2 browsers and reconnect. Avoid migrations requiring destructive rollback during demo week.
7. Keep previous release image/build for rollback; database migrations must remain compatible or use documented backup recovery. Never promise code rollback also undoes schema/data changes.

## Backup / restore exercise

Đạt documents DB schema/data expectations, Bảo writes scripts. Use pg_dump custom archive, store backup outside public web root with restricted access, define retention. Restore into a separate test DB, compare users/auctions/bids/results counts and inspect a sample auction. Record start/end time and actual restored state. Target lab RPO <=24h and RTO <=30min; these are goals, not existing guarantees. Do not test restore by overwriting staging DB.

## Acceptance scenario set

- Fresh checkout: install, migrate, seed, start; repeated migrate does not recreate tables.
- User A seller, B/C bidders: register/login; A creates/publishes; B/C view same auction.
- First bid equals opening accepted; below opening rejected; next bid below minimum rejected; self-bid rejected.
- 10 simultaneous same-price valid requests from bidders: one new accepted bid; current price/highest bidder/history consistent. Run with actual PostgreSQL, no mocked repository.
- Duplicate request key/body returns same bid; different body/auction with same key gets conflict; retry after timeout doesn't double-insert.
- Bid accepted <=30s from deadline extends remaining time to >=60s; close worker reads updated deadline; bid at/after ends_at rejected.
- Disconnect B, C bids, B reconnects: REST refresh catches up; older socket version does not overwrite newer REST state.
- Close job/restart: one result; no-bid auction has no winner; cancelled auction cannot accept bid.
- Unauthorized owner/admin request denied; missing CSRF denied; disabled account cannot reuse old session.
- HTTPS/WSS through Nginx; refresh nested frontend URL succeeds; database port inaccessible publicly; frontend JS has no secret.
- Phone viewport: list/detail/forms usable; loading/error/empty and keyboard labels visible.

## CI lab evidence

CI publishes a `auction-read-lab` JSON artifact when the lab run succeeds. It records the checkout SHA, 50 workers, 500 PostgreSQL-backed auction-list reads, successful-response p50/p95, outcomes, and API process CPU/RSS before and after. The read load goes directly to the API inside Compose; the separate browser smoke still goes through Nginx. The measurements do not represent Nginx's rate-limited public capacity, bid contention, or a production service-level guarantee. Record the observed numbers and target outcome, not the target as an achievement.

On 12 November 2026, the [push CI run for `9dc1940`](https://github.com/Giabao2110/BIDHUB/actions/runs/43170320087) recorded 500 successful reads out of 500 with 50 workers and 20 warmups on Linux and PostgreSQL 17.11. The [JSON artifact](https://github.com/Giabao2110/BIDHUB/actions/runs/43170320087/artifacts/13922131345) reports p50 49.41 ms, p95 91.54 ms, 0% errors, 553.09 ms elapsed, 0.5661 API process CPU seconds, and API process RSS from 98.16 to 105.25 MiB.

The same run restored 8 users, 8 auctions, 4 bids and 3 results into a separate database. Counts and content fingerprints matched. Restore and verification took 1 second, measured after backup creation with Compose already running. The Chromium smoke also read sold and unsold demo results from the live API through Nginx. The PostgreSQL HTTP suite covers scheduler closure.

The loopback TLS gate uses the host Nginx template, an ephemeral certificate for `localhost` and the existing full stack. It checks the HTTP redirect, SPA fallback, certificate-verified HTTPS, polling and WSS through both proxies, rejected foreign origin, and secure host-prefixed auth cookies in Chromium. The CI restart step also moves two seeded deadlines into the past while the API is stopped, then verifies the startup scheduler publishes the sold and unsold results via REST. The staging gate still needs real DNS, a publicly trusted certificate, and verification from outside the Linux host.

## MVP handoff

The local/CI baseline is commit [`3e1d1a9`](https://github.com/Giabao2110/BIDHUB/commit/3e1d1a9432054d42f778ab41f3c12c7eddd8b6ba), verified by [CI run 43175469807](https://github.com/Giabao2110/BIDHUB/actions/runs/43175469807).

- **Đạt, backend:** PostgreSQL tests cover session and CSRF, draft visibility and publish permissions, ten concurrent same-price bids, idempotency, late-bid extension, the close worker, cancellation and session revocation.
- **Phú, frontend:** Chromium exercises seller and bidder in separate browser contexts through Nginx and PostgreSQL, plus admin moderation at 390 px. It verifies retry after a lost response, real bid history, sold and unsold results and the revoked account's redirect. The four-viewport UI suite and stale-version tests cover additional scenarios with fixtures.
- **Bảo, infrastructure and integration:** Chromium verifies REST polling and room rejoin during a real bid. The same run passes the loopback HTTPS/WSS gate and closes two overdue auctions after restarting the API. Restore in a separate database matches content fingerprints and counts for 8 users, 8 auctions, 5 bids and 3 results.
- **Read lab:** 50 workers, 20 warmups, 500/500 reads, p50 48.38 ms, p95 88.69 ms, 0 errors, Linux and PostgreSQL 17.11. API CPU increased by 0.5593 seconds and API RSS moved from 98.86 to 101.70 MiB. [JSON artifact](https://github.com/Giabao2110/BIDHUB/actions/runs/43175469807/artifacts/13923104364)

For rehearsal, check out the verified SHA in a fresh checkout and follow [the full-stack Compose setup](BAO-IMPLEMENTATION.md#chạy-full-stack-bằng-docker). Use a disposable database and run migrations. Export a throwaway `SEED_DEMO_PASSWORD` in the shell, then run the seed inside the API container:

```sh
docker compose --env-file /path/to/private.env -f infra/compose.app.yaml exec -T -e NODE_ENV=test -e SEED_DEMO_PASSWORD api node apps/api/dist/database/seed.js
```

Open separate browser contexts for seller, bidder and admin. Use the seeded ended auctions to show both result states. To demonstrate anti-sniping, publish a new short auction, place a bid in the final 30 seconds and check the extended deadline before showing the result.

Record the exact SHA, CI link and rehearsal result before the team tags the release. The course demo and release tag are pending. Verification on a staging host requires a domain, a publicly trusted certificate and external reachability checks.

## Demo script (8–10 minutes)

1. Phú (2 min): home/search/detail and seller flow.
2. Đạt (3 min): two bidders, accepted/rejected bid, anti-sniping and result; explain lock/transaction/idempotency.
3. Bảo (3 min): disconnect/reconnect, architecture/network/HTTPS, CI and actual load/recovery evidence.
4. All (1–2 min): limitations, individual contributions, questions.

Prepare short-duration seeded auctions before demo, separate seller/bidder browsers, local fallback and recorded backup clip. Use non-sensitive sample data. Do not publish real passwords in the public repo.
