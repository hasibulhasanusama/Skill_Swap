# One project, cumulative releases

Stage 6 includes every source file from stages 1–5 plus permissions, account/admin controls, policies, announcements, support and cancellation flows. **Use only the latest ZIP. Do not concatenate files, stack ZIP folders, or run multiple copies of the server against the same port.** The project folder remains `skill-swap`, package version 0.6.0. All database migrations remain in `db/migrations` and apply in numeric order.

## Existing installation: Windows

1. Stop the old server with Ctrl+C. Back up PostgreSQL and private uploads (commands in API.md). Keep the old folder until the new version works.
2. Extract the latest ZIP into a different folder, e.g. `C:\Projects\SkillSwap-Stage6\skill-swap`.
3. Open PowerShell in that new `skill-swap` folder. Do not create a fresh .env first when importing your existing one.
4. Run:

```powershell
node scripts/upgrade.js --from "C:\Projects\SkillSwap-Stage5\skill-swap"
npm ci
npm run db:migrate
npm start
```

Replace the source path with your actual old project folder. `upgrade.js` imports the existing `.env` and copies private uploads if STORAGE_DIR is relative. Absolute storage paths remain pointed to the existing directory. Different existing destination files stop the import before copies begin; nothing is overwritten. Symlinked storage, parent-relative paths and ambiguous environment expressions require manual configuration. Repeating a successful import is safe when the files are unchanged.

An optional PowerShell wrapper performs the same first three steps:

```powershell
.\UPDATE.ps1 -PreviousProject "C:\Projects\SkillSwap-Stage5\skill-swap"
npm start
```

If your computer restricts PowerShell scripts, use the four ordinary commands above. No execution-policy change is required.

The database URL and session secret remain unchanged. Do not delete the database, do not recreate it, and do not run a reset command. `db:migrate` creates a migration ledger, adopts the existing idempotent stage 1/2 schema and applies stage 6. Later runs skip applied files and reject changes to their checksums. Seed is optional and additive in development; it is not needed to preserve your current users or bookings.

## First installation

```powershell
Copy-Item .env.example .env
npm ci
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the generated value into SESSION_SECRET in .env. Keep DATABASE_URL pointed to your PostgreSQL database. Start PostgreSQL (or `docker compose up -d`), then run:

```powershell
npm run db:migrate
npm run db:seed
npm start
```

Open http://localhost:3000. PostgreSQL must be installed or started separately. `npm ci` requires package-registry access. Demo seeding is disabled in production and requires DEMO_ENABLED=true.

## Stage 4 compatibility

Existing reservations have payment_required=false and remain usable without retroactive charges. Newly created paid reservations require sandbox checkout; free ones do not. Default commission is 10% (1000 basis points). Existing .env files continue working in local development; optional new variables are listed in .env.example. Set a separate 32+ character SANDBOX_WEBHOOK_SECRET if testing signed callbacks. No real-money provider is implemented.

To add fictional financial scenarios after upgrading, run `npm run db:seed` if the original demo accounts are missing, then `npm run db:seed:payments`. Both require enabled non-production demo mode and do not reset existing records.

## Stage 5 compatibility

The first four migration files are unchanged, preserving their existing checksums. Migration 005 adds project/review/portfolio records without deleting or replacing old users, payments, bookings or uploads. An existing .env needs no new value to use these features. To add fictional project examples after an upgrade, run `npm run db:seed:projects` in enabled non-production demo mode after the student demo accounts exist. Its work sample is stored through your existing private storage adapter; publication defaults keep that attachment private.

## Stage 6 compatibility

Migration files 001–005 are unchanged. Migration 006 assigns existing admin accounts the recovery superadmin role, adds session-version revocation and policy/account fields, and replaces the unconditional slot uniqueness with a reserved-only unique index. No learning/payment history is deleted. Default policy rows inherit configured environment commission/response values until an administrator saves explicit overrides. Old booking cancellation/response snapshots default to 24/72 hours; existing funded commission allocations remain unchanged.

No new environment value is required for ordinary local upgrades. Optional `npm run db:seed:administration` adds restricted fictional staff/support examples only in enabled non-production demo mode. Existing staff/student accounts are never silently promoted or overwritten. After an access/status change, affected users sign in again; password changes also invalidate older recovery links.

## Future stages

The same project layout and ordered migrations are retained. A future cumulative ZIP can replace the application source while your .env, private uploads and PostgreSQL database remain in use. Features that have not yet been built will still need their future release; this ZIP is complete through stage 6, not the finished full platform.

## Rollback

Stop the new server before returning to the old folder. Preserve the database backup taken before upgrade. This release adds columns/tables and does not delete old core records, but rolling back application code is not a substitute for a tested database restore. If a migration fails, fix the reported connection/schema problem and rerun it; do not remove ledger rows or edit applied SQL files.
