# HTTP authentication

`/api/v1/auth` serves `GET /csrf`, `GET /me` and `POST /register`, `/login`,
and `/logout`. Responses use `Cache-Control: no-store`. CORS allows credentials
for the exact browser `WEB_ORIGIN`.

- GET `/csrf` works before and after sign-in. It initializes an HttpOnly browser
  cookie when needed and returns a token signed over that cookie and the current
  session cookie. Send credentials and the token in `X-CSRF-Token` on writes.
  An Origin header, if present, must match `WEB_ORIGIN`. A new session or server
  restart invalidates the prior token. Fetch a token before each write.
- Cookies are host-only with `Path=/`, `HttpOnly` and `SameSite=Lax`. An HTTPS
  `WEB_ORIGIN` enables `Secure` and the `__Host-` prefix even when TLS terminates
  at a proxy. HTTP localhost uses the unprefixed cookie names.
- Registration normalizes email to lowercase and trims display names. It accepts
  8–256 character passwords, creates a MEMBER and issues a session in the same
  transaction. Email already in use returns 409 `EMAIL_EXISTS`.
- Login and registration issue a new seven-day session and revoke the previous
  session presented by that browser. Login returns a common 401 for unknown
  email, wrong password or disabled account. Logout revokes the presented
  session and clears its cookie. A repeated logout with a fresh CSRF token
  returns 204.
- The API limits credential submissions to 30 per source IP and eight per
  normalized email in a one-minute window per API process. Compose trusts one
  hop because its Nginx overwrites `X-Forwarded-For`. Enable `TRUST_WEB_PROXY=1`
  only behind such a trusted proxy with private API access. With an additional
  reverse proxy in front of this Compose setup, clients behind it share the IP
  bucket. The limiter and CSRF signing key are local to one process.

## Session persistence

Internal session functions live in `apps/api/src/modules/auth/sessions.ts`.
The HTTP layer reuses the existing password and session functions.

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
This command is separate from `npm test`. It also drives the real HTTP routes
against PostgreSQL and verifies cookie attributes, session rotation, CSRF,
credential limits and rollback. The HTTP tests use scripted clients.
