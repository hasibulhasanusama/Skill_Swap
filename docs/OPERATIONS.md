# Installation and operations — stage 7

This is a cumulative demo release, not a verified production deployment. Payments and withdrawals are sandbox simulations. Production email delivery is not implemented. Do not publish the seeded demo with real student documents.

## First local installation (PowerShell)

Install Node.js 22+ and PostgreSQL 17, or Docker Desktop for the database. Extract the ZIP and open PowerShell in `skill-swap`:

```powershell
npm ci
npm run setup
# Edit DATABASE_URL in .env if using your own PostgreSQL installation.
docker compose up -d db
npm run db:migrate
npm run db:seed
npm start
```

Open http://localhost:3000. `setup` creates independent random session/webhook secrets and never overwrites an existing .env. Do not commit .env. Demo password is `StudentDemo!2026`; root is `admin@skillswap.test`. All demo data is fictional.

## Existing installation

Stop the old server and take a backup first. Extract the new ZIP into a separate folder. Run `node scripts/upgrade.js --from "C:\your-old-folder\skill-swap"`, then `npm ci`, `npm run db:migrate`, `npm start`. Keep the old folder until verification. No reset or reseed is required. Applied migration checksums are unchanged; new source preserves .env, uploads and the existing database.

## Optional local app container

The default compose file continues to start only PostgreSQL. To run the app in Docker as well, run `npm run setup` first and use:

```powershell
docker compose -f compose.yaml -f compose.app.yaml build app
docker compose -f compose.yaml -f compose.app.yaml up -d db
docker compose -f compose.yaml -f compose.app.yaml run --rm app npm run db:migrate
docker compose -f compose.yaml -f compose.app.yaml run --rm app npm run db:seed
docker compose -f compose.yaml -f compose.app.yaml up -d app
```

This override is explicitly a localhost development demo. PostgreSQL and app ports bind to loopback. Uploads use the named `uploads` volume; do not run `down -v` on an installation you wish to keep. Docker build/start has not been exercised in this environment.

## Empty non-demo installation and initial administrator

Set DEMO_ENABLED=false and all SEED_* flags=false, configure a fresh database and run migrations. Skip all demo seeds. Temporarily add BOOTSTRAP_EMAIL, BOOTSTRAP_NAME and BOOTSTRAP_PASSWORD (16–128 characters) to your private .env, then run `npm run admin:bootstrap`. Remove those three entries afterwards. This command refuses if any administrator already exists and never promotes an existing student. Subsequent staff are managed by the first administrator through the UI. Do not reuse demo credentials.

## Health and shutdown

`GET /health/live` checks the process. `GET /health/ready` checks the migrated policy singleton; it returns only generic 503 details on failure and does not create a session. Startup checks database connectivity and policy schema. SIGINT/SIGTERM drain the HTTP server and close the pool, with a 10-second shutdown limit. Production startup additionally requires HTTPS APP_ORIGIN, a replaced session secret and DEMO_ENABLED=false. Production requires an HTTPS reverse proxy, restricted direct backend access, private backups and a real email integration; those are operator work, not bundled managed hosting.

## Backup and restore (host PostgreSQL tools)

Stop the application first so database/file references remain consistent. Keep .env, a database dump and all STORAGE_DIR files together as one private checkpoint. For a host PostgreSQL installation, with the PostgreSQL `bin` directory on PATH:

```powershell
New-Item -ItemType Directory -Force backups
pg_dump --dbname="postgres://skillswap:skillswap@localhost:5432/skillswap" --format=custom --file=backups/skillswap.dump
Copy-Item -Recurse storage/private backups/private
Copy-Item .env backups/config.env
```

Replace the example connection string with the actual connection configuration; prefer PGPASSFILE over putting credentials in shell history. For Docker app uploads, copy from the app container while it is stopped, using `docker compose -f compose.yaml -f compose.app.yaml cp app:/app/storage/private backups/private`. Check the copied directory structure. This is a manual recipe, not an executed backup test.

Restore into a **new empty database**, never the working installation:

```powershell
createdb --host=localhost --username=skillswap skillswap_restore
pg_restore --host=localhost --username=skillswap --dbname=skillswap_restore --no-owner --exit-on-error backups/skillswap.dump
```

Create a separate extracted project folder, copy the backup config to .env, point DATABASE_URL at skillswap_restore, and copy private files into that folder's STORAGE_DIR. Use another port/origin. Run migrations, start, and verify sign-in, private download, ledger totals and representative records before switching over. No destructive reset command is provided for an existing PostgreSQL installation.

## Disposable browser demo / reset

`$env:QA_DEMO="true"; npm run qa:demo` starts an isolated in-memory PGlite database with fictional fixtures and temporary uploads. It ignores DATABASE_URL and uses test-only memory sessions. Stop and restart it to reset that disposable demo. It must never be used for durable student work. No real database is cleared. Dev dependencies are required. In managed preview environments the preview daemon must own the process.

In another terminal run `$env:E2E_DEMO="true"; npm run test:e2e` after `npx playwright install chromium`. Set E2E_BASE_URL if the fixture uses another port. CHROMIUM_PATH optionally selects an installed executable. Never enable these mutation tests against real records. Four journeys are authored: learning, projects, staff/support, and mobile public layout. Browser launch was blocked here before the three original journeys could execute; none is claimed passed.
