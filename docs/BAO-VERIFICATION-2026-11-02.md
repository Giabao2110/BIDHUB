# Bảo BH-18 — verification 02/11/2026 (Asia/Saigon)

## Changes and ownership

Bảo's infrastructure/integration slice, implemented with AI assistance: private metrics listener, HTTP histogram with bounded labels, process/pool/socket gauges, lifecycle counters, Prometheus rules and Grafana provisioned dashboard. Adds optional Compose monitoring overlay, Linux systemd backup timer templates and dry-run-first retention tooling. Backend business functions remain Đạt's scope, frontend flows remain Phú's scope.

## Actually executed locally

- `npm run typecheck`: three workspaces pass.
- API compilation and full Docker API/web builds: pass.
- PostgreSQL 17 in isolated test container: 11 API tests, 8 migration/seed tests, 2 session tests, 1 category HTTP test pass; zero skipped.
- Typed contract fixtures: 3 tests pass; retention utility: 1 test pass. Total 26 tests across these commands.
- Docker Compose stack db/api/web/Prometheus/Grafana starts; migrations 001/002 apply.
- `promtool check config`: valid config and 3 valid rules.
- Existing Nginx/SPA/health/polling/WebSocket/foreign-Origin smoke: pass.
- Monitoring smoke: public route does not expose metrics; Prometheus up=1; at least 3 pool series; lifecycle alert loaded; Grafana API returns dashboard with 8 panels.
- Additional Prometheus instant queries confirm RSS, CPU and socket series exist, plus success/failure lifecycle counter series. Presence is not a performance benchmark.
- Retention test uses a temporary directory only; dry-run preserves files and explicit apply removes the oldest matching archive while preserving newest/unrelated files/subdirectories. No real backup archives were pruned.

Frontend source did not change in this slice. The 60 browser tests passed on the integrated main earlier on 02/11; they were not rerun locally for this slice. CI is configured to run them again together with monitoring smoke; a passing workflow result must be checked separately after push.

## Limits

Linux service/timer templates are not installed or activated anywhere. Alerts are configured/evaluated in Prometheus, with no Alertmanager or outbound notification channel. No VPS/domain/production HTTPS, host-wide CPU/RAM monitoring, offsite backup, production recovery SLA or real user load is established. Test passwords belong only to disposable local/CI containers, not production credentials.

Bid HTTP/concurrency testing still depends on Đạt's pending bid/cancel endpoints. These results do not make auth/auction CRUD or bidding complete. See MONITORING-OPERATIONS.md for commands and pending dependencies.
