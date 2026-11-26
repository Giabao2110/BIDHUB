# Local release and rollback lab

Use a separate Compose project name starting with bidhub-release-lab- and a loopback port. From the repository root, build the API and web images with infra/compose.app.yaml. The release override removes Compose build steps and accepts an image pair from a manifest. For each service, record its local image tag as ref and the exact docker image inspect .Id value as id. The script checks the references and verifies the running image IDs before smoke tests. Use distinct tags for each local candidate.

Bootstrap the isolated database and API using the base Compose file plus infra/compose.release-lab.yaml. Set DB_PASSWORD, DATABASE_URL, WEB_ORIGIN, BIDHUB_API_IMAGE and BIDHUB_WEB_IMAGE for the local stack. Run the migration explicitly and seed a synthetic sentinel row. Initialize the current manifest with the healthy pair. Invoke node scripts/release-lab.mjs CANDIDATE.json CURRENT.json bidhub-release-lab-NAME. The script assumes a schema compatible with either image pair. Back up and rehearse restore separately before a schema change.

The script tests frontend routes, HTTP liveness and readiness, a DB-backed auction read, Socket.IO polling and WebSocket, and rejection of an untrusted Origin. On failure it redeploys and verifies the previous API/web pair. Exit 0 means promotion succeeded, 1 means rejection and successful rollback, and 2 means rollback verification failed. Keep the current manifest on a writable local filesystem and use the same manifest for a given Compose project. The database volume stays attached to its original service. A local Compose rehearsal may interrupt requests while containers restart.

## Verified on 18/11/2026

The healthy pair passed. The bad pair changed both image IDs and pointed Nginx upstream to API port 3999, causing HTTP 502. The script restored both original image IDs and the smoke suite passed. The DB sentinel still read keep-me. The elapsed time from candidate deployment start through successful rollback verification was 35.623 seconds in this run. The disposable stack and its volume were removed.

The drill used Linux containers on Docker Desktop and HTTP loopback. Separate CI already covers HTTPS/WSS loopback. Remote staging, registry publishing and public DNS/TLS remain future work.
