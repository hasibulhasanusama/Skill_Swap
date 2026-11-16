# Stage 7 changes

Cumulative version 0.7.0 includes stages 1–6 unchanged migrations and retained workflows.

- Exclusive .env generation with random independent secrets.
- Separate initial administrator bootstrap, locked against duplicate initialization; no student promotion.
- Liveness/readiness checks and bounded graceful shutdown; production startup guards.
- Non-root app Dockerfile, optional localhost-only Compose app and persistent uploads volume.
- Disposable in-memory browser fixture; restart resets only this fictional test installation.
- Backup/restore, Docker, upgrade and deployment prerequisites in OPERATIONS.md.
- Optional system Chromium selection plus authored mobile viewport checks.

Baseline 95 tests passed; one additional health/bootstrap test passed. A final full suite rerun is recorded in VERIFICATION.md. No migration file from earlier releases was modified.

Three original Playwright journeys were attempted, but Chromium failed before page steps with `socket() failed: Operation not permitted`. This is an environment launch failure, not evidence that application journeys passed. No unsafe environment workaround was used. Four journeys are now available for execution in a supported browser environment. Public desktop preview was manually inspected. No claim is made for authenticated/mobile or production deployment verification.
