# Session persistence

Internal session functions live in `apps/api/src/modules/auth/sessions.ts`.
They do not register HTTP routes or choose cookie/CSRF/lifetime policies.
Password helpers are being reviewed with the database seed in PR #4; this
branch uses only the existing sessions/users schema from main.

- `createSession(pool, userId, expiresAt)` returns a random 256-bit bearer
  token and DB expiry, or null for a missing/disabled user. Invalid/past expiry
  throws RangeError. Only the SHA-256 hash is persisted; the raw token must not
  be logged or serialized into ordinary user JSON.
- Issuance uses one transaction/client and a shared user row lock. A disable
  transaction must lock/update the same user before deleting their sessions.
  Expiry is checked against PostgreSQL time after acquiring the row lock.
- `findSessionUser(pool, token)` returns the current DB user identity/role,
  excluding password/token hashes. Invalid, expired, revoked and disabled
  sessions return null. Disabling does not delete historical auctions/bids.
- `revokeSession(pool, token)` is safe to repeat. `revokeUserSessions(client,
  userId)` supports a transaction client for atomic disable+revoke; callers
  must hold the user lock until commit. It returns the deleted row count.

Run integration tests against a dedicated PostgreSQL 17 test database:

```sh
npm run test:auth-db --workspace @bidhub/api
```

`TEST_DATABASE_URL` is required. Tests create/drop a unique schema, never
truncate shared tables, and check token hashing/randomness, expiry, current
roles, disabled users, transactional/idempotent revocation and issuance waiting
for a concurrent disable (synchronized through PostgreSQL lock observation).
This command is
separate from `npm test`; pass results are backend persistence evidence only.
Cookie attributes, anonymous CSRF bootstrap, HTTP auth/rate limits and browser
integration remain subsequent slices; no protected write endpoint is exposed.
