# Bảo — independent infrastructure work, 21 October 2026

## Changes

- BH-01: `npm run doctor` checks Node 24, installed TypeScript, local `.env`, Compose v2 and Docker Engine. It is read-only, prints corrective setup actions and fails if any prerequisite is missing. It does not validate secrets, schema, npm version or user flows.
- BH-18: restore verification optionally accepts a reference fingerprint file. It compares counts and full-row content digests for all nine application/migration tables, fails on a mismatch and reports elapsed seconds. The restored DB remains separate and is retained for inspection.
- CI recovery now inserts a disposable completed auction, seller, bidder, accepted bid and result before backup. This avoids claiming recovery from an empty database. Reference fingerprints are captured before `pg_dump`; the CI database must remain idle during this exercise. The fixture has no working credentials and must never be applied to a shared database.
- README and architecture status now reflect implemented rooms, scheduler and container configuration.

## Verification and limits

- `npm run typecheck`: pass, all three workspaces.
- Initial host `npm test`: 8 pass, 1 skipped. Follow-up inside the API container with `TEST_DATABASE_URL`: **9 pass, 0 skipped**, including real PostgreSQL lifecycle/locking integration.
- `npm run build`: pass, contracts/API/web.
- Git Bash syntax checks for backup/restore and Node syntax check for doctor: pass.
- Restore script control flow with mocked Docker: matching reference accepted; mismatched reference and missing archive rejected. This does not validate PostgreSQL restore or the fingerprint SQL.
- Initial `npm run doctor` detected missing `.env` and unavailable Docker Engine. After setup, **all checks pass**: Node 24.18.0, dependencies, `.env`, Compose 5.1.4 and Engine 29.5.3.

## Actual Docker recovery exercise — 21 October, approximately 13:38 Asia/Saigon

- Created local `.env` from `.env.example`; confirmed Git ignores it. Recovery uses a separate private Compose env file with a random password, outside the repository.
- Docker Desktop initially failed on inaccessible stale `dockerInference` and secrets-engine sockets. Stopped the failed Docker processes and preserved their runtime directories under `.stale-*` names; restarted successfully. No factory reset or volume deletion was used.
- Environment: Windows Docker Desktop, Linux containers, Engine 29.5.3, PostgreSQL 17 Alpine, Node 24 Alpine. Tested working tree based on commit `da3fc8f` with the uncommitted infrastructure changes described here.
- Isolated Compose project: `bidhub-recovery-20261021`. API/web images built successfully; database and API healthy. Migration ran repeatedly without recreating tables or errors.
- Full API test suite inside the container: 9 pass, 0 skipped.
- Inserted the CI-only completed auction fixture into this isolated database. Backup archive: 18,607 bytes, custom pg_dump format.
- Restored into separate DB `bidhub_restore_1792564687_1511`: **2 users, 1 auction, 1 bid, 1 result**. Count/content fingerprint comparison passed. Restore plus verification reported **4 seconds**; this excludes Docker startup, image builds and backup creation.
- Inspected the restored auction: ENDED, bid amount 150 VND, final price 150 VND, winner agrees with the bid and auction highest bidder.
- Full-stack smoke through Nginx passed: SPA nested route fallback, liveness/readiness, Socket.IO polling/WebSocket and rejected untrusted Origin.
- Evidence and backup retained at `C:/Users/HP Pavilion/AppData/Local/BIDHUB/recovery-2026-10-21/`: `tests.txt`, `reference.txt`, `backup.txt`, `restore.txt`, `smoke.txt`, `bidhub.dump`. Private `compose.env` is in the same directory; do not publish it.
- Containers remain running; web is available at http://localhost:8080. API and DB have no host-published ports. Original and restored test databases remain available for inspection.

This is a successful local lab recovery exercise. The extended GitHub CI run has not been confirmed here. The four-second result on a tiny fixture is not a production RTO claim; backup scheduling, retention and host recovery remain separate work.

This completes the local recovery exercise portion of BH-18 and verifies the container/health/proxy foundation. BH-12/BH-14 still require integration with Đạt's bid/cancel services and Phú's client. BH-17 still requires an agreed host/domain and HTTPS deployment. BH-19 still requires real bid contention tests. No dashboard, production RPO/RTO or auction load result is claimed.

## Recovery exercise on a Linux host

Run from the repository root with the Compose environment variables loaded (or `COMPOSE_ENV_FILES` set). Keep backups and reference files in a restricted directory outside the repository. On a shared system, pause writes and lifecycle processing before taking the reference and dump; otherwise legitimate writes can invalidate the comparison.

```sh
umask 077
docker compose -f infra/compose.app.yaml exec -T db psql -U bidhub -d bidhub -v ON_ERROR_STOP=1 -At < infra/restore-fingerprint.sql > /private/backups/reference.txt
sh infra/backup.sh /private/backups/bidhub.dump
sh infra/restore-test.sh /private/backups/bidhub.dump /private/backups/reference.txt
```

Record the tested commit, host details, backup time, elapsed restore time and verification output. Inspect the reported test DB and its winning bid/result before manually removing that test DB. A successful lab run is evidence for that environment, not a production recovery guarantee. Fingerprints are content checks, not cryptographic authenticity checks.
