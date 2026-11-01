# BIDHUB

Real-Time Auction Platform — Web Application Development project.

## Current status

Development foundation with **frontend REST flows and a separate fixture preview, not a completed auction application**. Implemented: frontend account/session/draft/listing flows against the documented API contract, responsive screens, labelled preview fixtures, Express health and public categories endpoints, PostgreSQL migrations/demo seed, Argon2id helpers and internal hashed-session persistence, validated Socket.IO rooms, after-commit helper, lifecycle scheduler, CI and Docker/Nginx configuration. Authentication/CSRF HTTP routes and auction CRUD/list/detail HTTP routes are still missing: the frontend flows are verified with intercepted API fixtures, not end-to-end authentication or auction persistence. Transactional bidding, frontend realtime integration and production deployment remain unfinished.

Public categories are available from PostgreSQL at `GET /api/v1/categories`.
Run `npm run test:categories-db --workspace @bidhub/api` with a dedicated
`TEST_DATABASE_URL` to verify the real HTTP endpoint, stable ordering, empty
results and sanitized database errors. This command is separate from `npm test`
and fails explicitly if its test database is not configured.

Frontend-only preview: `npm ci`, then `npm run dev:web`. Open `/preview/auctions`, `/preview/login`, `/preview/auctions/new` or `/preview/dashboard` without an API/database. All preview data is labelled as sample data; preview forms do not authenticate users or save auctions. Normal `/auctions`, `/login`, `/register` and `/dashboard` routes call real APIs and show errors while required backend routes remain unavailable; there is no silent mock fallback.

## Team

- Lê Ngô Gia Bảo: lead, infrastructure, realtime, integration.
- Vũ Thành Đạt: backend, database, authentication and auction/bid rules.
- Phan Quang Phú: frontend, UI integration and end-to-end user flows.

## Start locally

Requires Node.js 24, npm 11 and Docker Desktop (Linux containers) or a local PostgreSQL 17 instance.

1. `npm ci`
2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
3. `docker compose -f infra/compose.yaml up -d`
4. `npm run db:migrate`
5. Terminal 1: `npm run dev:api`
6. Terminal 2: `npm run dev:web`

Open http://localhost:5173. API liveness: http://localhost:3000/api/v1/health/live. Readiness requires PostgreSQL: http://localhost:3000/api/v1/health/ready.

`infra/compose.yaml` is a **local database configuration**, not production infrastructure. Production containers must bind the API to `0.0.0.0` internally and expose it only through the reverse proxy. Do not use the example database password in production.

## Checks

`npm run doctor` checks Node, installed dependencies, local env file, Docker Compose and the Docker Engine without changing the environment. A failure exits nonzero and prints the next setup step.

`npm run typecheck` · `npm test` · `npm run build`

Frontend checks: `npm run format:check --workspace @bidhub/web` and `npm run test:preview --workspace @bidhub/web`. For browser checks on Windows with Edge installed, set `$env:PLAYWRIGHT_CHANNEL = 'msedge'` first. The preview suite uses fixtures, not a live API/database.

## Working documents

- [Architecture, database and code ownership](docs/ARCHITECTURE.md)
- [Database migrations and PostgreSQL integration tests](docs/DATABASE.md)
- [API and realtime contract](docs/API-CONTRACT.md)
- [Detailed assignments and 8-week timeline](docs/TEAM-PLAN.md)
- [Operations and demo acceptance](docs/RUNBOOK.md)
- [Bảo infrastructure/realtime implementation and deployment](docs/BAO-IMPLEMENTATION.md)
- [Bảo independent infrastructure progress and verification, 21 October](docs/BAO-VERIFICATION-2026-10-21.md)

Infrastructure update: auction room validation/caps, after-commit transaction helper, structured request logs, auction lifecycle scheduler and full-stack Docker/Nginx configuration are implemented. Local Docker builds, Nginx/socket smoke tests and a populated backup/restore exercise passed on 21 October; see the dated verification report for evidence and limits. Bid/cancel services still need integration with the same row-lock discipline. Real-host TLS deployment remains unfinished.

The schedule targets 6 December 2026 provisionally; confirm the course's actual deadline. Money is stored as integer VND and serialized as strings. All times are UTC in storage/API; display in Asia/Ho_Chi_Minh.
