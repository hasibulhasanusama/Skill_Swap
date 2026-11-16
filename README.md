# Skill Swap — Stage 7 (cumulative stages 1–7)

A student-only marketplace with verification, reciprocal exchanges, private learning rooms, messaging, material sharing, agreed rescheduling, bilateral session completion and sandbox payment protection, practical projects, portfolios and eligible reviews. Version **0.7.0**. This release includes all previous stages in one project; **use only the latest ZIP, without combining source files from older ZIPs**. The planned demo implementation stages are packaged; operational and browser checks listed below remain unverified.

Start with `START_HERE_BN.md` for Bangla instructions or `docs/UPGRADE.md` for the complete installation and upgrade guide.

## Requirements

Node.js 22+ (tested with 24.22.1), npm and PostgreSQL 17. Docker Compose is optional for the database. The frontend is served by Express; opening index.html directly does not connect the APIs.

## Existing installation: Windows / PowerShell

Stop the old server and back up PostgreSQL plus uploads. Extract this ZIP to a new folder. From the new `skill-swap` folder:

```powershell
node scripts/upgrade.js --from "C:\Projects\SkillSwap-Stage6\skill-swap"
npm ci
npm run db:migrate
npm start
```

Replace the old project path with your real folder. The import copies the old .env and relative private uploads without overwriting conflicts. Absolute STORAGE_DIR paths stay in use. The existing database URL and session secret are preserved. All six migrations apply automatically in order, with a checksum ledger; subsequent runs skip applied migrations. No database reset or fresh seed is needed to retain existing data. See `docs/UPGRADE.md` for supported paths and the optional UPDATE.ps1 wrapper.

## First installation

```powershell
npm ci
npm run setup
```

The setup command creates independent random secrets without overwriting an existing .env. Set DATABASE_URL to your PostgreSQL database. Start PostgreSQL, or use:

```powershell
docker compose up -d
```

After the database is ready:

```powershell
npm run db:migrate
npm run db:seed
npm start
```

Open http://localhost:3000. APP_ORIGIN must match the URL used for recovery links. Production cookies require HTTPS; production email is unavailable until a provider is integrated.

## Demo accounts

All demo records are fictional. Password for every demo account: `StudentDemo!2026`.

| Login                                                   | Role / purpose                                         |
| ------------------------------------------------------- | ------------------------------------------------------ |
| admin@skillswap.test                                    | Separate protected administrator                       |
| student1@skillswap.test                                 | Approved student, seeded active exchange with student2 |
| student2@skillswap.test                                 | Reciprocal partner for the seeded learning room        |
| student3@skillswap.test                                 | Approved student; teaches Python, wants illustration   |
| student4@skillswap.test                                 | Approved student; teaches illustration, wants Python   |
| student5@skillswap.test through student7@skillswap.test | Additional approved students                           |
| student8@skillswap.test                                 | Unverified student for the review journey              |

`db:seed` requires DEMO_ENABLED=true and non-production NODE_ENV. It adds 8 students, 1 admin, 12 listings, future availability, reciprocal preferences, an active exchange, two fictional messages and one notification. With SEED_FINANCE_DEMO=true (the new .env.example default), it also adds three sandbox payment attempts, one completed session with released earnings, a pending withdrawal and one unresolved absence dispute. Existing .env files are not overwritten; you can add these financial fixtures separately with `npm run db:seed:payments`. With SEED_PROJECT_DEMO=true (new .env.example default), the seed also adds a fictional two-version project, feedback, a private TXT work sample, public portfolio text and an eligible review. Add these to an existing demo separately with `npm run db:seed:projects`. SEED_ADMIN_DEMO=true adds four separate restricted administrator accounts, one fictional public announcement and one in-progress support request; use `npm run db:seed:administration` after an upgrade to add them separately. It is additive and repeatable; it does not reset existing records. Do not use demo accounts in a public deployment.

## Commands

| Command                                      | Purpose                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| npm start                                    | Express app with PostgreSQL-backed sessions                                              |
| npm run dev                                  | Watch server files                                                                       |
| npm run db:migrate                           | Apply unapplied numbered SQL migrations with checksum checks                             |
| npm run db:seed                              | Add fictional development records                                                        |
| npm run db:seed:payments                     | Add repeatable fictional sandbox finance scenarios                                       |
| npm run db:seed:projects                     | Add fictional project revisions, feedback, public portfolio text and an eligible review  |
| npm run db:seed:administration               | Add restricted fictional staff, announcement and support example                         |
| npm run upgrade:files -- --from "OLD_FOLDER" | Import old config/uploads; no database deletion                                          |
| npm run check                                | Check all source/test JavaScript syntax                                                  |
| npm test                                     | API, DOM interface, migration and upgrade tests                                          |
| npm run test:e2e -- --list                   | Discover the authored browser journey without launching a browser                        |
| npm run test:e2e                             | Browser journey; requires an isolated running seeded demo app and explicit E2E_DEMO=true |

## Architecture and access

`public/` is buildless HTML/CSS/Vanilla JavaScript ES modules. `server/` contains Express APIs, scrypt password hashing, CSRF protection, sessions, authorization and relational transactions. PostgreSQL is the main database; no localStorage authentication or main data store is used. `db/migrations/` retains stages 1–6. `server/storage.js` defines a put/read/delete adapter with a local private filesystem implementation; an actual object-store provider is not implemented.

Student ID documents remain private to their owner and staff with verification-file permission. Learning/project/portfolio files and payment evidence require their corresponding content/dispute review permissions for staff. Learning materials additionally allow the participants of the related booking/exchange. Verification documents are never automatically shared with learning partners. Uploads are limited to 5 MB; IDs accept PDF/PNG/JPEG signatures, and materials also accept UTF-8 TXT/MD attachments. File checks are not antivirus scanning. Private responses use no-store and downloads are attachments.

Conversations are participant-only, scoped to a booking/exchange, paginated and protected by backend checks. Administrators have attendance/reschedule inspection but no conversation API access. Message retries use client UUID idempotency keys. Completed/cancelled/rejected rooms retain readable history but do not accept new messages. Refresh is manual; real-time push, email and push notifications are not implemented.

A reschedule proposal does not change or release the original reservation. The other participant accepts/rejects; the proposer can cancel. Acceptance locks both participants and rechecks paid-booking and active-exchange conflicts, including other sessions in the same agreement. Duration, fee and original slot ID remain unchanged. Accepted changes are audited. After a full reservation cancellation, its original future slot can be reserved again. Rescheduling alone does not re-list the old slot.

Meeting links are external HTTPS links saved by the session teacher. Opening one never records attendance. Attendance is self-reported after the session starts. After a standard session ends, the mentor records delivery and the learner explicitly confirms. For funded bookings, confirmation releases eligible simulated earnings unless a dispute hold blocks it. COMPLETION_RESPONSE_HOURS defaults to 72; deadline expiry does not auto-confirm or release funds. New paid bookings require sandbox checkout before mentor delivery can be recorded. Old bookings remain legacy reservations without retroactive charges. Free bookings do not require checkout. Self-service cancellation now follows the booking notice snapshot and refund/hold rules described below. A real-money provider is not implemented.

## Verification

`npm run check` passed. `npm test`: **96 passed, 0 failed** (the previous 95 plus health/bootstrap operational coverage). API tests use PGlite, an embedded PostgreSQL engine, and a test-only memory session store. Standalone PostgreSQL session persistence and independent-connection concurrency are not operationally verified here.

Four Playwright journeys are included. The three original journeys were attempted but Chromium launch failed on an environment socket permission error before browser steps; the mobile journey is authored only. Public desktop preview was visually inspected. Authenticated/mobile QA remains unverified. See `docs/VERIFICATION.md` and `docs/OPERATIONS.md`.

## Sandbox payment behavior

Payments, refunds, earnings and withdrawals are **local simulations only**. There is no real escrow, fund custody, card processor, bank transfer or real-money gateway. Every payment UI is labeled SANDBOX. The provider interface is implemented by `server/providers/sandbox.js`; `PAYMENT_PROVIDER=sandbox` is the only supported choice. Production sandbox operations require SANDBOX_ENABLED=true explicitly.

Checkout calculates the session amount from the stored booking. The included platform commission is snapshotted at funding (COMMISSION_BPS, default 1000 = 10%); amounts are BDT integer minor units. Mentor share is gross minus floor(gross × commission_bps / 10000). Fees are not added on top of the quoted session price. Failed attempts persist without allocating funds. Retry keys, unique provider events and booking/allocation constraints prevent duplicate charges, releases and refunds.

A funded allocation stays held until explicit learner confirmation or a reasoned administrator dispute decision. Mentor completion and expired response deadlines alone never release it. Before release, either participant can open a payment complaint; absence complaints require the scheduled end to have passed. The allocation is held until review. Both participants can add statements and private evidence; an administrator can assign and resolve the complaint with a recorded reason. Partial dispute refunds release only the reasoned remainder. Resolving a payment dispute does not assert that a lesson was delivered.

Administrators can issue full/partial simulated refunds. Released refunds reverse net earnings and commission proportionally by recalculating the remaining split. They fail atomically if the mentor's available balance cannot cover the reversal, such as when earnings are reserved or paid out. There is no negative balance/debt recovery system. Payment disputes are available only before release; post-release concerns require admin refund review rather than a new hold on already released earnings.

Withdrawal requests reserve available simulated balance immediately. Mentors can cancel pending requests; admins can reject and restore balance or simulate successful/failed payouts. Failure stays pending without a second debit; verified retry/payout references prevent paying twice. The earnings ledger records release, refund and withdrawal movements. No bank details are collected.

The signed sandbox webhook is for local integration tests: HMAC-SHA256 over the exact raw JSON request bytes in X-Sandbox-Signature. The provider_ref is looked up and verified server-side; payload prices/statuses are never trusted. The default development fallback signing key is SESSION_SECRET for compatibility with older .env files; set a separate SANDBOX_WEBHOOK_SECRET (32+ characters) for explicit configuration. Never put the signing key in frontend code.

## Stage 4 demo accounts and journey

With financial demo fixtures seeded, student5@skillswap.test has released simulated earnings and one pending withdrawal. student6@skillswap.test is that completed session's learner. student7@skillswap.test has an unresolved absence dispute with student3@skillswap.test. The demo admin can inspect evidence/statements, assign review and decide refund/release under Payment disputes. Use the same documented demo password.

For a new payment journey, reserve an upcoming paid session, simulate failure and then success in checkout, view its held allocation and private learning room, and inspect Payments & earnings. Delivery/confirmation is available only after the scheduled end. Isolated API tests simulate elapsed time; do not change real records or the system clock to demonstrate completion.

## Projects, portfolio and review behavior

Approved Student Mentors assign an exercise or project within their own funded/free/legacy booking or an active/completed exchange teaching agreement. The recipient is derived from the actual learning context. Instructions stay fixed after creation. Due dates are optional and informational; late submissions are not automatically blocked. Learners submit a private summary, optional HTTPS work link and optional PDF/image/UTF-8 TXT/MD attachment up to 5 MB. New versions are accepted only after changes are requested; feedback is mentor-only and previous versions/feedback stay in history. Approved versions are immutable. Submission UUIDs/content fingerprints prevent accidental duplicate uploads on retries.

An approved submission can become a student-controlled portfolio entry. Independent projects can also be added without claiming mentor review. New entries default private. Publishing text and sharing an attachment are separate choices; the file stays private unless share_file is explicitly true and the entry is public. Public files use the consented portfolio-entry route, never anonymous access to the private file API. Unpublishing, disabling file sharing, moderation, owner suspension or loss of student approval revokes future public downloads. Already downloaded copies cannot be recalled. Unverified owners can still save an entry privately. Mentor approval is task feedback, not certification or proof of teaching ability.

Reviews require a learner-confirmed completed booking or an entirely completed reciprocal exchange with both teaching directions confirmed. Booking reviews target the real mentor; exchange reviews target the actual other participant. Targets cannot be chosen by the browser. Self/duplicate reviews are blocked. Public counts and averages use only currently eligible visible reviews from approved, unsuspended students. Refund cancellation removes that booking's review from public calculations without deleting its history. Review/portfolio moderation requires a recorded reason and audit; restoring content does not bypass eligibility or the owner's private visibility. Saved skills persist per account and hide unavailable listings.

Student profiles now show actual completed teaching-session counts, eligible rating aggregates and public portfolio samples. Demo content and reviews are explicitly fictional.

## Stage 5 demo journey

Run the normal fictional seed, or `npm run db:seed:projects` after upgrading an existing enabled demo. Sign in as student6@skillswap.test to see a two-version project, mentor feedback and portfolio entry. Student5@skillswap.test is its mentor and has the eligible fictional review. The portfolio's text is public but its attachment is initially private. If financial fixtures already exist, the task uses that completed paid booking; otherwise the project seed creates a fictional completed legacy reservation without retroactive payment. Repeating the project seed does not duplicate its work or files.

## Stage 6 administration and account controls

Every /api/admin endpoint now requires an explicit current permission. The existing demo administrator is the recovery superadmin; verifier, support, moderator and finance roles have separate permissions. Changes apply on the next request, not only to sidebar links. Separate staff accounts never promote a student account. Role-management controls reject self-role/access changes and removal of the last active superadmin. The recovery role itself cannot be edited. Private student IDs, dispute evidence and learning/portfolio files require their corresponding staff file permissions.

Student search/status management preserves stored records and invalidates prior sessions. Password changes require the current password, invalidate existing sessions and earlier recovery links, then sign the owner out. Self-deactivation is blocked while active learning, held payments or available/pending earnings remain. It retains history and hides public content; an administrator can restore access. Students can hide public profile/portfolio access while keeping private entries, and can control in-app activity/reminder display. Published listings/reviews can still display their student name.

Categories can be created/renamed/archived; listings have independent administrator hide/restore state that the owner cannot bypass. Existing session history is retained. Registration and listing publication can be paused. Versioned policy settings control new commission, response and cancellation defaults. Existing booking deadline/notice and funded commission snapshots are preserved. Database overrides take precedence over environment defaults after they are explicitly saved.

Upcoming unpaid/free/legacy reservations can be cancelled without charge. Funded held reservations allow the learner to cancel before the snapshotted notice cutoff (default 24 hours), or the mentor to cancel any time before start, with a full remaining simulated refund. Disputed/released allocations need review rather than this automatic path. Cancellation is idempotent, retains history and makes an original future slot reservable again. Active exchanges can be cancelled by a separate mutual request/acceptance; authorized support may instead terminate an unfulfilled agreement after review with a recorded reason. Neither action fabricates completion or moves real money.

General support tickets have owner/reviewer-only conversation, assignment, status and reasoned resolution. Public/student-only announcements and drafts respect the selected audience/publication state. Reports use stored counts and monthly booking creation; the admin UI can export that summary to CSV. No external email or message is sent by these controls.

## Restricted demo staff

After main seed with SEED_ADMIN_DEMO=true, or `npm run db:seed:administration`, these separate fictional accounts use StudentDemo!2026:

| Account                  | Role                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| admin@skillswap.test     | Recovery superadministrator                                          |
| verifier@skillswap.test  | Student verification and ID files                                    |
| support@skillswap.test   | Student support, student search and exchange review/termination      |
| moderator@skillswap.test | Categories, listing/review/portfolio moderation and announcements    |
| finance@skillswap.test   | Sandbox payments, withdrawals, payment disputes and dispute evidence |

No real credentials, money or institutional endorsements are included. Existing .env, users, passwords and uploads are retained by upgrade. The first five SQL files remain byte-for-byte unchanged for checksum compatibility.

## Remaining release plan

Stage 7 adds safe setup, initial administrator bootstrap, health endpoints, graceful shutdown, a disposable resettable QA demo, Docker packaging and backup/restore instructions. See `docs/OPERATIONS.md`. Standalone PostgreSQL/session/concurrency, authenticated/mobile browser execution, Docker, restore and deployment still require verification in a suitable environment. Real-money integration and production email are not implemented.

The original brief is not claimed fully verified or production-ready yet. See `docs/API.md`, `docs/IMPLEMENTATION.md`, `docs/UPGRADE.md`, `docs/VERIFICATION.md`, and `docs/STAGE_6_WALKTHROUGH.md`.
