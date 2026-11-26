# BIDHUB — technical completion and acceptance, 26 November 2026

Canonical course staging: <https://bidhub.duckdns.org/>.
This is the current status; earlier dated reports remain historical evidence.
The user delegated remaining implementation and deployment to the AI assistant.
Team ownership remains Bảo (infrastructure/realtime/integration), Đạt
(backend/database/domain), Phú (frontend/browser integration). This work is
AI-assisted and does not represent independent authorship by Bảo.

## Verified against the real staging host

- Public HTTPS validates normally; HTTP redirects to HTTPS. SPA fallback,
  health/live and health/ready pass from outside the VM.
- Socket.IO polling and WebSocket pass through the public TLS proxy in
  Node and Edge. Foreign Origin is rejected. These checks were rerun on
  26 November after the backup exercise.
- Registration, publish, bid and seller realtime delivery were exercised
  in separate browser contexts on 25 November. Persisted history contained
  one bid per test auction. Cookies had Secure, HttpOnly, SameSite=Lax and
  the `__Host-` prefix. Mobile evidence is in the dated staging report.
- Certbot renewal **dry-run for the canonical domain** completed successfully
  on 26 November. This verifies challenge/renewal configuration; the issued
  certificate still expires on 23 February 2027.
- PostgreSQL backup and restore were executed on the existing Azure VM:
  archive 20,546 bytes; restored 4 users, 2 auctions, 2 bids and 2 results
  into a separate database. All table counts/content fingerprints matched.
  Measured restore verification was 1 second, complete backup/drill 3 seconds,
  with containers already running. These are observed demo timings, not a
  disaster recovery RTO or SLA. API was stopped briefly to obtain a coherent
  fingerprint and dump, then restarted. External smoke passed afterwards.

The archive stays in a restricted directory on the same VM. It protects
against database mistakes but does not protect against loss of that VM/disk.
No off-host archive destination was supplied or configured.

The isolated rollback drill also passed on the same Azure VM on 26 November:
the intentionally broken upstream failed the candidate smoke; the original
API and web image IDs were restored, polling/WebSocket smoke passed and the
cloned DB fingerprint was unchanged. Elapsed time from candidate deployment
to verified rollback was **31 seconds**. The disposable containers and volume
were cleaned up. The public staging Compose project was not replaced in this
drill. An initial run stopped at a Dockerfile base-image reference error;
the script was corrected and rerun before recording this success.

The repository's systemd backup service/timer was installed on the existing
host. The timer is enabled for 02:00 UTC daily plus up to five minutes jitter
(09:00–09:05 Vietnam time). An explicit service run returned `Result=success`.
Archives use a restrictive umask and stay outside the repository. There is
no automatic deletion or off-host replication; periodically check disk space
and copy an archive to an operator-controlled private destination.

## Roles and administrator handoff

`MEMBER` is the ordinary user role and `ADMIN` is the administrator role.
Public registration always creates MEMBER. The server enforces permissions;
the dashboard exposes moderation only for ADMIN. Tests cover member denial,
moderation audit reasons, revocation and the last-admin guard.

The last role inventory found 4 synthetic MEMBER accounts and no ADMIN.
The user has been asked to register their own account and specify its email.
No guessed account was promoted, and no public/default admin password was
created. Actual owner/admin acceptance remains open until that identity is
provided. Passwords must stay outside chat, logs and repository.

## Integrated regression and recovery tools

The 18 November local work is now included in PR #24 rather than left only
in the original working directory:

- Draft PATCH regression checks anonymous 401, other-user 403 with unchanged
  stored title/version, and legitimate owner 200 with one version increment.
- `scripts/release-lab.mjs` and `infra/compose.release-lab.yaml` verify pinned
  API/web image IDs and smoke tests before promotion, and verify rollback.
- `scripts/staging-rollback-drill.sh` copies a private dump into a newly named
  disposable Compose project, uses loopback port 18080, injects an invalid
  upstream in a candidate web image, then verifies restoration of the original
  image pair and unchanged DB fingerprints. It rejects existing lab projects
  or volumes and never changes the live Compose project.

Run the host drill from the repository root with operator-supplied private
paths, on a Docker host with Compose supporting `!reset` and `!override`:

```sh
sh scripts/staging-rollback-drill.sh /path/to/private.env \
  /path/to/private.dump bidhub-release-lab-UNIQUE_NAME
```

Use a lowercase alphanumeric/hyphen suffix in place of `UNIQUE_NAME`.
The script removes only its disposable project/volume on exit. It retains
the source backup. Use an archive of stable, closed synthetic auctions so
scheduler work in the clone does not invalidate the fingerprint comparison.
This is application image rollback with a compatible schema, not rollback of
an incompatible migration or a destructive recovery of the live database.

## Remaining acceptance gates

1. **Administrator identity:** user supplies the intended account email after
   registration. Promote that exact account, then check login and moderation.
2. **BH-02 / team:** Đạt and Phú review the current DB/API/UI contracts.
3. **BH-20 / Phú:** review live E2E/CI evidence and manually accept phone and
   keyboard flows on staging.
4. **BH-21 / team:** review the report/slides, rehearse the 8–10 minute demo and
   confirm each member can explain their contribution.
5. **BH-22 / Bảo and reviewer:** review exact-SHA CI and operational evidence,
   receive Đạt's review required by TEAM-PLAN, then merge/tag the accepted
   release. A prepared PR or AI test run is not a team review or signoff.

PR: <https://github.com/Giabao2110/BIDHUB/pull/24>.
No final release tag or fabricated human acceptance is recorded here.

## Credit and scope limits

The existing Azure Students spending limit remains the required boundary.
No upgrade to Pay-As-You-Go, new managed database, monitoring subscription,
registry or extra Azure VM is needed for these drills. VM/disk/IP consume
student credit. A spending cap does not make them permanently free and loss
of credit can interrupt the course demo. Do not delete the shared VM/resource
group as cleanup: other applications may also be present on that host.

The 22 November feature-freeze gate is past. RC 29 November and 6 December
handoff remain provisional course-plan dates. No percentage is promoted to
100% while the administrator and human acceptance gates are incomplete.
