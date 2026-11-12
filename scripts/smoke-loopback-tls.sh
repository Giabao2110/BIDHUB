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
