# BidHub draft authorization review — 18/11/2026

The HTTP integration suite ran against disposable PostgreSQL 17 on branch Giabao2110/cv-evidence-lab, base 987762c. The new test uses an owner, a regular peer, and an anonymous client. The peer receives its own valid session and CSRF token.

- Anonymous PATCH: 401 UNAUTHENTICATED.
- Peer PATCH: 403 FORBIDDEN. Stored title and version match their pre-request values.
- Owner PATCH: 200. The same payload changes the stored title and increments the version once.
- Suite: 10 passed, 0 failed, 0 skipped.

The test verifies the existing owner check. A future 2xx for the peer or a database mutation after a denial merits escalation to the backend owner, with the test name and a redacted reproduction. Rerun the suite after the fix and verify the legitimate owner still succeeds. Scope is the draft PATCH endpoint in a local test environment with synthetic data.
