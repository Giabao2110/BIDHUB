#!/bin/sh
set -eu
# Run on Linux host; archive stays local, never in repository/public directory.
umask 077
output=${1:?Usage: backup.sh /absolute/private/path/backup.dump}
case "$output" in /*) ;; *) echo 'Use an absolute output path' >&2; exit 1;; esac
[ ! -e "$output" ] || { echo 'Output already exists' >&2; exit 1; }
temporary="${output}.partial"
trap 'rm -f -- "$temporary"' EXIT HUP INT TERM
docker compose -f infra/compose.app.yaml exec -T db pg_dump -U bidhub -d bidhub -Fc > "$temporary"
[ -s "$temporary" ]
mv -- "$temporary" "$output"
echo "Backup saved: $output"
