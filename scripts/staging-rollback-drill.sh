#!/bin/sh
# Rehearse against a disposable Compose project on an existing Docker host.
# Usage: sh scripts/staging-rollback-drill.sh PRIVATE_ENV PRIVATE_DUMP PROJECT
set -eu
umask 077
env_file=${1:?Private Compose env file required}
archive=${2:?Private PostgreSQL archive required}
project=${3:?Disposable project name required}
case "$project" in bidhub-release-lab-*) ;; *) echo 'Unsafe lab project name' >&2; exit 2;; esac
case "$project" in *[!a-z0-9-]*) exit 2;; esac
[ -f "$env_file" ] && [ -f "$archive" ]
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ] || {
  echo 'Lab project already exists; refusing to reuse it' >&2; exit 2;
}
! docker volume inspect "${project}_data" >/dev/null 2>&1 || {
  echo 'Lab volume already exists; refusing to reuse it' >&2; exit 2;
}
live() { docker compose --env-file "$env_file" -f infra/compose.app.yaml "$@"; }
api_id=$(docker inspect --format '{{.Image}}' "$(live ps -q api)")
web_id=$(docker inspect --format '{{.Image}}' "$(live ps -q web)")
export BIDHUB_API_IMAGE=$api_id BIDHUB_WEB_IMAGE=$web_id
export BIDHUB_LAB_PORT=18080 WEB_ORIGIN=http://127.0.0.1:18080
lab() {
  docker compose --env-file "$env_file" -p "$project" -f infra/compose.app.yaml \
    -f infra/compose.release-lab.yaml "$@"
}
temp_dir=$(mktemp -d)
cleanup() {
  lab down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$temp_dir/api.Dockerfile" "$temp_dir/web.Dockerfile" "$temp_dir/before" "$temp_dir/after"
  rmdir "$temp_dir"
}
trap cleanup EXIT
lab up -d --no-build --wait db
lab exec -T db pg_restore -U bidhub -d bidhub --no-owner --no-acl --exit-on-error < "$archive"
lab exec -T db psql -U bidhub -d bidhub -v ON_ERROR_STOP=1 -At < infra/restore-fingerprint.sql > "$temp_dir/before"
smoke() {
  docker run --rm --network host -e WEB_ORIGIN \
    -v "$PWD/scripts/smoke-compose.mjs:/app/staging-smoke.mjs:ro" \
    --entrypoint node "$api_id" /app/staging-smoke.mjs
}
verify_ids() {
  [ "$(docker inspect --format '{{.Image}}' "$(lab ps -q api)")" = "$BIDHUB_API_IMAGE" ]
  [ "$(docker inspect --format '{{.Image}}' "$(lab ps -q web)")" = "$BIDHUB_WEB_IMAGE" ]
}
lab up -d --no-build --wait api web
verify_ids
smoke
printf 'FROM %s\nLABEL bidhub.rollback.drill="candidate"\n' "$api_id" > "$temp_dir/api.Dockerfile"
printf 'FROM %s\nRUN sed -i s/api:3000/api:3999/g /etc/nginx/conf.d/default.conf\n' "$web_id" > "$temp_dir/web.Dockerfile"
docker build -q -t "$project-api:candidate" -f "$temp_dir/api.Dockerfile" "$temp_dir"
docker build -q -t "$project-web:candidate" -f "$temp_dir/web.Dockerfile" "$temp_dir"
export BIDHUB_API_IMAGE=$(docker image inspect --format '{{.Id}}' "$project-api:candidate")
export BIDHUB_WEB_IMAGE=$(docker image inspect --format '{{.Id}}' "$project-web:candidate")
[ "$BIDHUB_API_IMAGE" != "$api_id" ] && [ "$BIDHUB_WEB_IMAGE" != "$web_id" ]
started=$(date +%s)
lab up -d --no-build --wait api web
verify_ids
if smoke; then
  echo 'Fault injection unexpectedly passed' >&2
  exit 1
fi
export BIDHUB_API_IMAGE=$api_id BIDHUB_WEB_IMAGE=$web_id
lab up -d --no-build --wait api web
verify_ids
smoke
lab exec -T db psql -U bidhub -d bidhub -v ON_ERROR_STOP=1 -At < infra/restore-fingerprint.sql > "$temp_dir/after"
cmp "$temp_dir/before" "$temp_dir/after"
printf 'PASS: failed candidate rejected; original API/web image IDs restored; DB fingerprints unchanged; elapsed seconds: %s\n' "$(($(date +%s) - started))"
