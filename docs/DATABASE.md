# Database migrations and tests

Requires Node.js 24, installed workspace dependencies and PostgreSQL 17.
Migration 001 is immutable. Migration 002 adds explicit non-null validation
for a winning result's price and rejects negative auction versions. HTTP
payloads, shared types and auction visibility are unchanged.

## Apply migrations

For the local development database, follow the root README to start PostgreSQL
and configure `.env`, then run from the repository root:

```sh
npm run db:migrate
npm run db:migrate
```

The second run applies nothing. The migration runner uses one connection,
the existing PostgreSQL advisory lock, and one transaction per migration.
DDL and the `schema_migrations` ledger entry commit or roll back together.
Concurrent runners serialize and reread the ledger after acquiring the lock.
Never edit an already-applied file; add a new numbered SQL file instead.

The compiled CLI works in the existing Docker image as before:

```sh
node apps/api/dist/database/migrate.js
```

Migration 002 validates existing rows and deliberately fails if legacy results
have incomplete winner/bid/price tuples or versions are negative. It does not
guess missing values, delete records, or rewrite winners. Investigate the
affected data before retrying. A failed migration is not recorded as applied.
There is no automatic destructive down migration; deployment recovery uses a
validated backup or a reviewed forward repair. See the operational runbook.

## Dedicated integration database

Use a disposable development/test database. Do not supply staging/production
credentials. For example, start an isolated local container (the password here
is for this localhost-only disposable test instance):

```sh
docker run --rm -d --name bidhub-db-test \
  -e POSTGRES_USER=bidhub -e POSTGRES_PASSWORD=local_test_only \
  -e POSTGRES_DB=bidhub_test -p 127.0.0.1:55432:5432 postgres:17-alpine
docker exec bidhub-db-test pg_isready -U bidhub -d bidhub_test
```

Wait until readiness reports accepting connections. On macOS/Linux:

```sh
export TEST_DATABASE_URL='postgres://bidhub:local_test_only@127.0.0.1:55432/bidhub_test'
npm run test:db --workspace @bidhub/api
npm test
npm run typecheck
npm run build
docker stop bidhub-db-test
```

On PowerShell, set the variable with
`$env:TEST_DATABASE_URL = 'postgres://bidhub:local_test_only@127.0.0.1:55432/bidhub_test'`.
The dedicated `test:db` command fails if the variable is missing, instead of
silently skipping DB assertions. It does not read `DATABASE_URL` as a fallback
and does not require creating or editing the local `.env` file.

Each integration test creates a uniquely named schema and drops only that
schema at the end. It never truncates public/shared tables. The test role needs
permission to connect, create schemas and tables in this test database. Failed
connections and assertions exit nonzero. Interrupted runs may leave isolated
schemas; discarding the disposable container removes them without touching
the development database.

## Coverage and integration handoff

`test:db` covers fresh-schema migration, repeated and concurrent runners,
ledger/data preservation, transactional rollback/retry, upgrade from 001 with
data, rejection of invalid legacy rows, and valid winner/no-bid closure using
the existing lifecycle service after migration 002. Negative assertions cover
partial result tuples, version/status/money/time/FK/idempotency constraints
and BIGINT overflow. Existing listing/seller/history/expiry indexes are checked.

This command is separate from `npm test`; the latter retains the team's
existing policy/realtime/scheduler suite. Suggested CI integration for the
infrastructure owner, with its existing `TEST_DATABASE_URL` PostgreSQL service:

```sh
npm run test:db --workspace @bidhub/api
```

CI configuration is unchanged in this slice. Run both suites locally before
handoff; a passing default suite alone does not establish migration coverage.
Auth endpoints, bid/cancel races, visibility decisions and frontend integration
remain separate work.

## Development demo seed

After migration, set `SEED_DEMO_PASSWORD` privately in your local environment
(16–1024 characters, no committed default) and run:

```sh
npm run db:seed --workspace @bidhub/api
```

For a compiled checkout or a dedicated development API container, supply
`DATABASE_URL` and `SEED_DEMO_PASSWORD` through its environment, then run:

```sh
node apps/api/dist/database/seed.js
```

The seed refuses `NODE_ENV=production`. Use `NODE_ENV=development` only for
the dedicated development container; do not change the production service's
environment to run a seed. Do not target a shared or production database.
It creates three accounts:
`admin@demo.bidhub.invalid` (ADMIN), `seller@demo.bidhub.invalid` and
`bidder@demo.bidhub.invalid` (MEMBER). Each initial password is the supplied
value, stored with an independent Argon2id salt using the shared password
helper. See [node-argon2](https://github.com/ranisalt/node-argon2) for the native
dependency and default parameters. No HTTP login endpoint is added here.

It inserts one demo category and six auctions covering all five statuses plus
an unsold ENDED example. ACTIVE and SCHEDULED use times relative to the first
seed run; the two bids and two results match their auctions/prices/users.
IDs use the reserved `d3000000-0000-4000-8000-*` demo namespace.

The entire seed is transactional and serialized with concurrent seed runs.
Rerunning preserves passwords, disabled accounts, deadlines, versions and bid
history, including legitimate changes made after seeding. It does not revive
expired demos or reset passwords when the supplied value changes. Start with
a fresh disposable demo database when you need fresh countdowns. Conflicting
reserved identities or unique email/slug collisions fail and roll back instead
of overwriting existing records. These are sample data, not real users/items.

`test:db` also checks concurrent/repeated seeding, hashes, time/reference
consistency, winner/no-bid results, preservation after subsequent changes,
collision rollback and production/password guards. `npm test` includes the
password hash/verify test. Adding the native dependency changes the workspace
manifest/lockfile; verify the existing Alpine API image before handoff.
