#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "${WEB_ORIGIN:-}" == https://localhost ]] || {
  echo 'TLS smoke requires the isolated CI runner and https://localhost' >&2
  exit 1
}
tls_dir="$(mktemp -d)"
container="bidhub-ci-tls-$$"
cleanup() {
  docker logs "$container" 2>/dev/null || true
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -f -- "$tls_dir/fullchain.pem" "$tls_dir/privkey.pem" "$tls_dir/nginx.conf"
  rmdir -- "$tls_dir"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost' -keyout "$tls_dir/privkey.pem" \
  -out "$tls_dir/fullchain.pem" 2>/dev/null
sed -e 's/bidhub\.example\.com/localhost/g' -e 's/listen /listen 127.0.0.1:/' \
  infra/host-tls.conf.example > "$tls_dir/nginx.conf"

# Simulate deadlines passing during an outage on the already seeded disposable DB.
docker compose -f infra/compose.app.yaml stop api
aged="$(docker compose -f infra/compose.app.yaml exec -T db psql -U bidhub -d bidhub -At -v ON_ERROR_STOP=1 <<'SQL'
WITH aged AS (
  UPDATE auctions
  SET starts_at = clock_timestamp() - interval '2 hours',
      ends_at = clock_timestamp() - interval '1 second'
  WHERE (id = 'd3000000-0000-4000-8000-000000000103' AND status = 'ACTIVE')
     OR (id = 'd3000000-0000-4000-8000-000000000102' AND status = 'SCHEDULED')
  RETURNING id
)
SELECT count(*) FROM aged;
SQL
)"
test "$aged" = '2'
docker compose -f infra/compose.app.yaml up -d --wait api
docker compose -f infra/compose.app.yaml up -d --no-deps --force-recreate --wait web
docker run --rm -d --network host --name "$container" \
  -v "$tls_dir/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$tls_dir:/etc/letsencrypt/live/localhost:ro" nginx:stable-alpine >/dev/null

redirect="$(curl --noproxy localhost --retry 10 --retry-all-errors --retry-delay 1 -fsS -o /dev/null -w '%{http_code} %{redirect_url}' http://localhost/auctions/test-nested-route)"
test "$redirect" = '301 https://localhost/auctions/test-nested-route'
export NODE_EXTRA_CA_CERTS="$tls_dir/fullchain.pem"
export BIDHUB_TLS_SMOKE_SPKI="$(openssl x509 -in "$tls_dir/fullchain.pem" -pubkey -noout |
  openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64 -A)"
node scripts/smoke-compose.mjs
node scripts/smoke-browser-socket.mjs
node scripts/smoke-browser-auth.mjs

node --input-type=module <<'JS'
import assert from 'node:assert/strict';

for (const [suffix, winner, price] of [
  ['103', 'Demo Bidder', '110000'],
  ['102', null, null],
]) {
  const response = await fetch(`${process.env.WEB_ORIGIN}/api/v1/auctions/d3000000-0000-4000-8000-000000000${suffix}/result`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, `missing result for auction ${suffix} after restart`);
  const result = await response.json();
  assert.equal(result.winner?.displayName ?? null, winner);
  assert.equal(result.finalPriceVnd, price);
  assert.ok(Number.isFinite(Date.parse(result.closedAt)));
}
console.log('API restart smoke passed: overdue active and scheduled auctions closed with the expected results');
JS
