# Stage 7 verification record

Date: 16 November 2026. Node.js 24.22.1. Cumulative version 0.7.0.

## Executed

- Baseline `npm test`: 95 passed, zero failures.
- New operations test: passed. Confirms readiness 503 before migration, readiness 200 after migration, no health-session cookie, minimum bootstrap password, stored password hash, separate superadmin creation and refusal of a second bootstrap.
- Final full `npm test`: 96 passed, zero failures.
- `npm run check`: all JavaScript syntax checks passed.
- `npm run test:e2e -- --list`: 4 tests discovered; discovery is not execution.
- Public desktop preview opened in the cloud browser and visually inspected.
- Setup helper smoke check: fresh random secrets and existing configuration preservation passed.
- Earlier SQL migrations compared byte-for-byte with stage 6 before packaging.

API tests use Express/Supertest and isolated PGlite PostgreSQL engines with test-only memory sessions. DOM tests use JSDOM and mocked APIs. These cannot prove independent-connection PostgreSQL races, durable sessions or browser behavior.

## Browser execution attempt

The three original Playwright journeys were actually invoked with E2E_DEMO=true against the disposable seeded installation using system Chromium. All three failed at browser launch, before application steps, with `socket() failed: Operation not permitted` and process SIGABRT. Therefore **zero browser journeys are claimed passed**. This is an environment launch restriction, not a tested application failure or a successful workflow. No security restrictions were bypassed. The new 390×844 mobile public-layout journey was authored/discovered only.

Use a supported local browser environment to execute the four tests. See OPERATIONS.md for the isolated fixture. Never run mutation tests against real student records. Retain traces of actual application failures for diagnosis.

## Remaining unverified work

- Authenticated browser workflows, mobile visual review and CSV browser download.
- Standalone PostgreSQL installation, durable sessions and independent-connection concurrency.
- Docker build/start, Windows PowerShell wrapper execution, backup/restore drill.
- HTTPS reverse proxy, production cookies and actual hosting deployment.

Production email delivery and real-money gateway integration are not implemented. Private files are local filesystem storage, not object storage. All payments/withdrawals are simulated. The Docker and restore instructions are supplied configuration/recipes, not successful deployment evidence. The seven planned implementation bundles are present, but these operational acceptance checks remain open.
