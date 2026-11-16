# Stage 1 API

JSON requests, same-origin cookies. First GET `/api/auth/me` to receive a CSRF token, then send `X-CSRF-Token` on every modifying request. Login rotates both session and token. Error response: `{ "error": "message" }`. IDs are integer primary keys. List response is `{items,total,page,pages}` for public listings; other collections expose `{items}`.

| Method | Path                         | Access / behavior                                                              |
| ------ | ---------------------------- | ------------------------------------------------------------------------------ |
| GET    | /api/auth/me                 | Current public user and CSRF token                                             |
| POST   | /api/auth/register           | name, institution, email, password (12+), enrolled=true; does not auto-login   |
| POST   | /api/auth/login              | email, password; returns user and new csrf                                     |
| POST   | /api/auth/logout             | Signed-in session                                                              |
| POST   | /api/auth/recover            | email; private development outbox                                              |
| POST   | /api/auth/reset              | token, password; expires after 30 min; single-use; invalidates user's sessions |
| PUT    | /api/profile                 | name, institution, bio; signed in                                              |
| GET    | /api/verification            | Own submission history                                                         |
| POST   | /api/verification            | multipart document; student; unverified or rejected                            |
| GET    | /api/files/:id               | Private attachment; owner/admin only                                           |
| GET    | /api/categories              | Public                                                                         |
| GET    | /api/listings                | q, category, level, max_price (minor units), available=true, page; 9/page      |
| GET    | /api/listings/:id            | Public published listing and future unreserved slots                           |
| GET    | /api/mentors/:id             | Approved Student Mentor public profile/listings                                |
| POST   | /api/listings                | Approved student                                                               |
| PUT    | /api/listings/:id            | Approved owner                                                                 |
| POST   | /api/listings/:id/slots      | Approved owner; starts_at ISO timestamp with timezone                          |
| POST   | /api/bookings                | Approved student; slot_id; server pricing; participant overlap prevention      |
| GET    | /api/dashboard               | Own listings, participant reservations, latest verification                    |
| GET    | /api/admin/overview          | Admin; database counts                                                         |
| GET    | /api/admin/verifications     | Admin; submissions with private file IDs                                       |
| POST   | /api/admin/verifications/:id | Admin; status approved/rejected, reason minimum 5 characters                   |
| GET    | /api/admin/audit             | Admin; latest 100 decisions                                                    |

Listing body: category_id, title, description, level (Beginner/Intermediate/Advanced), objectives, prerequisites, duration_minutes (15–180), fee_minor (integer 0–10000000), exchange_enabled (boolean), status (draft/published/inactive). Unrecognised body properties are stripped by validation. Admin approvals record reviewer, time and reason in the same transaction as user status and audit creation.

# Backup and restore

Back up the database and private storage together while writes are paused. Database backup command (requires PostgreSQL client):

```sh
pg_dump --format=custom --file=skillswap.dump --dbname=postgres://skillswap:skillswap@localhost:5432/skillswap
pg_restore --clean --if-exists --dbname=postgres://skillswap:skillswap@localhost:5432/skillswap skillswap.dump
```

Use your own credentials through a secure PostgreSQL credential mechanism in deployed environments. Copy storage/private separately and restore it to STORAGE_DIR with restrictive permissions. Test a restore in an isolated database before relying on it. Backups include private student documents and session records; restrict access. No backup/restore was executed here.

# Stage 2 exchange API

All mutations require the current session CSRF token. Approved students are required for matches, requests, negotiation, acceptance and completion. Unverified students may prepare their own preferences. Reports are accessible to participants. Admin inspection and resolution are admin-only.

| Method | Path                                            | Body / response                                                                                                                      |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | /api/exchange/preferences                       | Own skills, availability, timezone                                                                                                   |
| PUT    | /api/exchange/preferences                       | skills:[{skill,kind:teach/learn,level:1/2/3}], availability:[{weekday,start_minute,end_minute}]; replaces own preferences atomically |
| GET    | /api/exchange/matches                           | Approved counterpart profiles, give/receive skills, overlapping windows, ranking score and plain-language explanations               |
| POST   | /api/exchanges                                  | recipient_id, requester_skill, recipient_skill, message; checks a current complementary match                                        |
| GET    | /api/exchanges                                  | Own requests, history, agreement revisions, sessions and reports                                                                     |
| POST   | /api/exchanges/:id/respond                      | action: accept/reject/cancel; recipient accepts/rejects pending requests; either participant cancels pending/negotiating requests    |
| PUT    | /api/exchanges/:id/agreement                    | revision, requester_objective, recipient_objective, sessions:[{teacher_id,starts_at,duration_minutes}]                               |
| POST   | /api/exchanges/:id/accept-agreement             | revision; same revision must be accepted by both participants                                                                        |
| POST   | /api/exchanges/:id/sessions/:sessionId/complete | Empty body; teacher marks, then learner confirms, after the scheduled end                                                            |
| POST   | /api/exchanges/:id/reports                      | reason (10–3000 characters); active/completed agreement; one open report per participant                                             |
| GET    | /api/admin/exchanges                            | Agreements, sessions and reports for inspection                                                                                      |
| POST   | /api/admin/exchange-reports/:id/resolve         | reason (10–3000); records resolution and audit event atomically                                                                      |

Levels: 1=Beginner, 2=Intermediate, 3=Advanced. Weekdays: Sunday=0 through Saturday=6. Recurring availability minutes are local Asia/Dhaka minutes since midnight. Skill names are normalized for case and whitespace; synonyms are not inferred. A recommendation requires reciprocal skills, teaching level at least requested learning level, and at least 15 minutes of recurring overlap. These are preference matches, not reserved sessions.

Actual agreement dates use timezone-qualified ISO timestamps. Both sides must teach at least one session, 15–180 minutes per session, with 2–20 sessions overall. Both participants explicitly accept the dates, even when they differ from their recurring preferences. Schedules cannot overlap internally or with active exchange sessions or reserved paid sessions. Accepting again checks conflicts and approval status. Saving a revision clears both acceptance flags. Only after both accept does the agreement become active. Active objectives remain immutable; the stage 3 rescheduling endpoints support mutually accepted time changes.

State flow: pending → negotiating → active → completed. Pending can be rejected or cancelled; negotiating can be cancelled. Active agreements cannot be unilaterally cancelled; participants can report an unfulfilled commitment. Completion does not infer attendance from links or release money. Open reports and their administrative outcomes do not change confirmed session progress or move funds.

# Stage 3 learning API

All prior endpoints remain supported. Learning rooms are scoped to `booking` or `exchange`; session operations use `booking` or `exchange-session`. IDs are positive integers. Mutations require a session CSRF token. Participants have room access; administrators do not gain conversation access through their role.

| Method | Path                                         | Body / response                                                                           |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | /api/learning/contexts                       | Own booking/exchange rooms, counterpart, title, status, unread count                      |
| GET    | /api/learning/:kind/:id                      | Own room, participants, sessions, materials, attendance, reschedule history               |
| GET    | /api/learning/:kind/:id/messages             | Latest 100 in ascending order; optional before=message_id; has_more                       |
| POST   | /api/learning/:kind/:id/messages             | body (1–4000), client_key UUID; idempotent for same sender/context/body/key               |
| POST   | /api/learning/:kind/:id/read                 | through_id; marks own incoming context messages up to this ID read                        |
| POST   | /api/learning/:kind/:id/materials            | Multipart title (2–120), material; verified participant, active room                      |
| GET    | /api/files/:id                               | Owner/admin or related learning participant; verification IDs remain owner/admin only     |
| PUT    | /api/learning-sessions/:kind/:id/meeting     | meeting_url; teacher only; HTTPS without embedded credentials, or blank                   |
| POST   | /api/learning-sessions/:kind/:id/attendance  | status=present/absent, optional note; self-report after start                             |
| POST   | /api/learning-sessions/:kind/:id/reschedules | starts_at ISO with timezone, reason (5–1000); future session, original duration preserved |
| POST   | /api/reschedules/:id/respond                 | action=accept/reject/cancel; participant and state checks                                 |
| POST   | /api/bookings/:id/complete                   | Mentor only, after end; delivery recorded and response deadline set                       |
| POST   | /api/bookings/:id/confirm                    | Learner only after mentor delivery; marks learning completed                              |
| GET    | /api/notifications                           | Own latest 100 activities, total unread, upcoming sessions within 24 hours                |
| POST   | /api/notifications/:id/read                  | Mark own notification read; repeated calls safe                                           |
| GET    | /api/admin/learning-sessions                 | Latest bookings, attendance statements and reschedule history; admin only                 |

Booking `status` remains reserved/cancelled for compatibility; `learning_status` is scheduled/completion_pending/completed. Completion records never collect or release money in this release. COMPLETION_RESPONSE_HOURS is an integer 1–720, default 72. Expired deadlines leave completion_pending until learner confirmation; there is no automatic payout.

Reschedule requests transition pending → accepted/rejected/cancelled, or superseded when delivery is recorded. A proposal retains original_starts_at. Acceptance requires the other participant, a still-upcoming uncompleted session, both active verified accounts and no schedule conflict. The original time stays reserved until acceptance; then the booking/session timestamps change atomically. Booking fee and slot ID stay unchanged. Active exchange reschedules increase the exchange revision with consent recorded in the proposal/response audit. Objectives do not change.

Completed/cancelled/rejected rooms are read-only for new messages. Learning material sharing requires an approved participant and active exchange or uncompleted reserved booking. Existing materials remain accessible to participants. Material/verification uploads use server/storage.js; permitted material formats are PDF, PNG, JPEG and valid UTF-8 TXT/MD, maximum 5 MB. All downloads are attachments and private responses use no-store. File-signature checks are not antivirus scanning.

## Release upgrades

`schema_migrations` records each filename, checksum and applied time. Migration runners lock the ledger and apply each SQL file and ledger insertion in the same transaction. Existing stage 1/2 databases are adopted by their idempotent migration files. Do not edit applied SQL; add the next numbered file. See UPGRADE.md for preserving .env, uploaded files and the database during cumulative updates.

# Stage 4 sandbox finance API (current behavior)

Earlier completion/no-payment descriptions refer to historical checkpoints. Version 0.4.0 uses the rules below: existing reservations retain payment_required=false, while new positive-fee reservations set it true. Every new paid session is one booking and one session allocation. Free and legacy reservations never acquire a retroactive charge.

All money is **integer BDT minor units**, all provider activity is simulated, and no card/bank details are accepted. Unsafe authenticated requests require CSRF. The sole CSRF exemption is the exact signed sandbox webhook endpoint; it requires its own HMAC authentication.

| Method | Path                                    | Access / body / behavior                                                                                             |
| ------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/payments/checkout/:bookingId       | Learner only; stored booking quote, included commission, mentor share, allocation and sandbox policy                 |
| POST   | /api/bookings/:id/checkout              | Approved learner; idempotency_key UUID, scenario=success/failure; ignores browser prices/statuses                    |
| POST   | /api/payments/sandbox/webhook           | HMAC-SHA256 of exact raw JSON bytes in X-Sandbox-Signature; body provider_ref UUID; verifies stored provider receipt |
| GET    | /api/payments/summary                   | Own payment attempts, related allocations/refunds, own earnings ledger/withdrawals and computed totals               |
| POST   | /api/withdrawals                        | Approved student; amount_minor positive integer, idempotency_key UUID; reserves available simulated balance          |
| POST   | /api/withdrawals/:id/cancel             | Owner; pending request restores reserved balance once; repeated cancel safe                                          |
| GET    | /api/payment-disputes                   | Participant's payment complaints                                                                                     |
| POST   | /api/payment-disputes                   | Participant; booking_id, category, reason (10–3000); held allocation only; absence after scheduled end               |
| GET    | /api/payment-disputes/:id               | Participants/admin; complaint, related booking/allocation, statements, evidence metadata                             |
| POST   | /api/payment-disputes/:id/statements    | Participant; body (5–4000); unresolved only                                                                          |
| POST   | /api/payment-disputes/:id/evidence      | Participant; multipart title, evidence; PDF/PNG/JPEG/UTF-8 TXT/MD, max 5 MB; unresolved only                         |
| GET    | /api/files/:id                          | Existing owner/admin access plus related booking participants for dispute evidence                                   |
| GET    | /api/admin/payments                     | Admin; latest 200 attempts/allocations/refunds/withdrawals, all mentor accounts and net commission total             |
| POST   | /api/admin/allocations/:id/refunds      | Admin; amount_minor, reason (10–3000), idempotency_key UUID; open disputes must use resolution instead               |
| POST   | /api/admin/allocations/:id/release      | Admin; reason (10–3000); requires learner confirmation and no dispute hold; duplicate release is safe                |
| GET    | /api/admin/payment-disputes             | Admin; full complaint queue and active admin assignment choices                                                      |
| POST   | /api/admin/payment-disputes/:id/assign  | Admin; admin_id, reason; active admin only; records audit                                                            |
| POST   | /api/admin/payment-disputes/:id/resolve | Admin; outcome=refund/release, reason, refund_minor for refund; assigned reviewer if assigned                        |
| POST   | /api/admin/withdrawals/:id/decide       | Admin; action=pay/reject, scenario=success/failure, reason, idempotency_key UUID                                     |

## Funding and release rules

Payment amounts come from the stored booking; commission basis points are snapshotted at successful funding. The default is 1000 bps (10%). Commission is floor(remaining gross × bps / 10000), mentor share is the remainder. Checkout has no additional fee above the session price.

A failed sandbox payment stores a failed attempt and no allocation. Repeating the same key/scenario returns its same receipt. A changed scenario requires a new key. One successful payment and one allocation per booking are protected by unique constraints. Provider event IDs are unique; replay verifies metadata and does not reallocate. The server never treats the browser's amount, currency, balance or payment-status fields as authoritative.

For payment_required bookings, mentor delivery requires successful funding. Learner confirmation updates delivery and releases the eligible allocation in one transaction. An open dispute or missing funding rolls back confirmation. Mentor delivery and deadline expiry do not release by themselves. Admin manual release also needs learner confirmation; only reasoned dispute resolution can override that requirement. Payment decisions never falsely mark learning as delivered.

The sandbox provider stores charge/refund/payout records inside the same PostgreSQL transaction. The interface is a future integration boundary, not a ready external gateway: real asynchronous provider actions would require suitable durable job/outbox and reconciliation handling, and real holding/release must be supported by that provider. No such real-money integration is included.

## Dispute and refund rules

An open complaint sets on_hold=true for an unreleased allocation. Either booking participant can submit a complaint, statement and private evidence. Admin assignment/decision reasons are audited. Assigned disputes are resolved by that reviewer. A full refund cancels the reservation; a partial dispute refund releases only the reasoned remaining allocation. A release resolution gives the remaining simulated mentor share without claiming session completion. Resolved complaints reject duplicate decisions and late statements/evidence.

Admin refunds outside a dispute support full/partial reversal. For already released allocations, the remaining net/commission split is recalculated, wallet/platform ledger entries reverse the difference, and available mentor balance must cover the reversal. Insufficient balance rolls back the entire refund, including the provider simulation; there is no negative balance or debt-recovery feature. Fully refunded allocations cannot be paid/released again. Post-release complaints cannot create a new hold; an administrator may review a refund subject to available balance.

## Withdrawal rules

Requesting a withdrawal debits available simulated earnings into a pending reservation immediately. Cancel/reject restores it once. Successful simulated payout retains that debit and marks paid. A failed payout remains pending with the balance still reserved; a new payout key can retry. Duplicate payout keys do not create a second payout, and paid requests cannot be cancelled. No real bank account, payout rail or transfer is used.

## Configuration

PAYMENT_PROVIDER supports sandbox only. SANDBOX_ENABLED is implicit for local non-production development and must be explicitly true in production to enable simulated transaction routes. COMMISSION_BPS is an integer 0–10000. SANDBOX_WEBHOOK_SECRET must be 32+ characters when set; compatibility fallback is the existing session secret. Keep this secret server-side. COMPLETION_RESPONSE_HOURS remains a response deadline, not an automatic release policy. SEED_FINANCE_DEMO=true adds repeatable historical fictional financial fixtures during the main demo seed; db:seed:payments can add them separately in enabled non-production demo mode.

# Stage 5 projects, portfolio and reviews

Prior endpoints and payment rules remain supported. Migration 005 adds the tables below without changing migration files 001–004. Task feedback, submission approval and portfolio publication never release money or imply completed lesson attendance.

| Method | Path                                   | Access / body / behavior                                                                                                                                        |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/projects/contexts                 | Signed in; own valid teaching bookings/exchanges for task selection                                                                                             |
| GET    | /api/projects/tasks                    | Participant's tasks with latest submission state and computed progress                                                                                          |
| POST   | /api/projects/tasks                    | Approved teacher; context_kind booking/exchange, context_id, kind exercise/project, title (2–120), instructions (10–6000), optional future due_at ISO timestamp |
| GET    | /api/projects/tasks/:id                | Assigned teacher/learner only; assignment, all submission versions, feedback, file metadata and submission capability                                           |
| POST   | /api/projects/tasks/:id/submissions    | Approved assigned learner; multipart or JSON summary (10–6000), optional external_url, client_key UUID; optional multipart work file                            |
| POST   | /api/project-submissions/:id/feedback  | Approved assigned mentor; verdict approved/changes_requested, comment (10–6000); latest submitted version only                                                  |
| POST   | /api/project-submissions/:id/portfolio | Approved submission owner; portfolio fields; approved work only; private by default                                                                             |
| GET    | /api/portfolio                         | Own entries including private status, file metadata and moderation reason                                                                                       |
| POST   | /api/portfolio                         | Approved student; independent project, optional multipart work; portfolio fields                                                                                |
| PUT    | /api/portfolio/:id                     | Owner; update text, URL, visibility and file consent; publishing requires approved student status; private saving remains available when unverified             |
| GET    | /api/portfolio/:id                     | Anonymous public metadata only when owner approved/unsuspended, student role, public visibility and no moderation hide                                          |
| GET    | /api/portfolio/:id/file                | Consented public attachment only; same visibility checks; attachment download, no-store                                                                         |
| GET    | /api/reviews                           | Own issued history, public eligible received reviews and currently unreviewed eligible contexts                                                                 |
| POST   | /api/reviews                           | Approved participant; context_kind booking/exchange, context_id, rating integer 1–5, comment (10–6000); server derives target                                   |
| GET    | /api/saved-skills                      | Own saved published/available skills                                                                                                                            |
| POST   | /api/saved-skills/:id                  | Save published skill; authenticated, idempotent                                                                                                                 |
| DELETE | /api/saved-skills/:id                  | Remove from own saved list; authenticated, idempotent                                                                                                           |
| GET    | /api/admin/reviews                     | Admin; latest 200 review records for moderation                                                                                                                 |
| GET    | /api/admin/portfolios                  | Admin; latest 200 portfolio records for moderation                                                                                                              |
| POST   | /api/admin/reviews/:id/moderate        | Admin; status visible/hidden, reason (10–3000); audit recorded                                                                                                  |
| POST   | /api/admin/portfolios/:id/moderate     | Admin; status visible/hidden, reason (10–3000); does not change owner visibility                                                                                |

Portfolio fields: title (2–120), description (10–6000), optional external_url, share_file boolean (default false), visibility private/public (default private). Multipart fields may use true/false string values for share_file. Only HTTPS URLs without embedded user/password credentials are accepted. Work uploads allow PDF/PNG/JPEG signatures and UTF-8 TXT/MD, up to 5 MB; no executable/archive uploads. They are format-checked attachments, not antivirus-scanned content.

## Task and submission authorization

Booking assignments require its actual mentor, reserved status and successful allocation when payment_required=true. Free and legacy bookings are allowed without retroactive payment. Active/completed exchanges require a teaching session by the assigning participant. The learner is the actual other participant, never a supplied arbitrary user ID. Task metadata/submission history is participant-only, without an admin project-enumeration API. Uploaded files retain existing authorized administrator review access.

Instructions are fixed after creation. Due dates are informational; late submissions are not automatically blocked. Learners can submit a first version, then a new version only after changes_requested. A latest submitted version accepts one mentor decision, and approved versions are immutable. Same client key/content returns the original submission; a reused key with changed context/content/file is rejected. Parent context/task locking prevents duplicate versions. Failed file/DB writes clean up the new file.

## Publication and privacy

Approved project work can become a portfolio entry; independent entries do not claim mentor approval. Public metadata excludes booking IDs, submission IDs, private feedback and raw private file IDs. Text visibility and file sharing are separate. Public download authorization is evaluated on every request via the portfolio entry. Unpublishing, share_file=false, moderation hide, owner suspension, loss of student approval or student role revoke future access. The private /api/files route still requires authorization even when a public entry references its file. Downloaded copies cannot be recalled.

Owners cannot bypass administrator hiding by editing. Restoring an entry does not publish a private owner draft. Unverified owners may save entries privately but cannot publish them. Task approval indicates feedback on the stated task, not certification or proof of teaching ability.

## Review eligibility and aggregates

A booking reviewer must be its actual learner, with reserved booking status, completed learning state and learner_confirmed_at. The mentor is derived from that booking; self/duplicate reviews are rejected. An exchange reviewer must belong to a completed exchange with at least one teaching session from each participant and all sessions marked delivered and independently confirmed. Each participant may review the actual other participant once. The browser cannot choose an arbitrary target.

Public review lists/counts/averages re-evaluate current completion eligibility and author approval/suspension/role plus moderation visibility. A fully refunded/cancelled booking removes its review from public calculations without deleting the historical review. Empty aggregates return review_count=0 and average_rating=null. Public profile review lists return the latest 100; aggregate statistics count all eligible records. Confirmed teaching-session counts include completed confirmed reserved bookings and individually confirmed exchange sessions in active/completed agreements.

`GET /api/mentors/:id` now additionally returns portfolio, reviews and statistics {completed_sessions,review_count,average_rating}. Fake testimonials, professional certifications or institutional endorsements are not generated; all demo reviews/work samples are explicitly fictional.

# Stage 6 administration, policies and account API

Earlier stage notes are historical where superseded here. All existing /api/admin operations now pass a current database-role permission check; hiding sidebar links is not authorization. Unknown admin prefixes are denied. Existing administrator accounts are migrated to the recovery superadmin role. Separate staff creation does not promote or overwrite an existing student account.

| Method     | Path                                    | Access / body / behavior                                                                                        |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET        | /api/policies                           | Public; resolved current defaults, text, revision and publication/registration state                            |
| GET        | /api/announcements                      | Published public items; signed-in students additionally see student-audience items; no drafts                   |
| GET / PUT  | /api/account/settings                   | Owner; profile_public and notifications {activity,session_reminders}                                            |
| POST       | /api/account/password                   | Owner; current_password, new_password (12–128); old sessions/recovery links invalidated                         |
| POST       | /api/account/deactivate                 | Student owner; current_password, reason (10–3000); guarded deactivation retaining history                       |
| GET        | /api/account/commitments                | Own reservations, server cancellation eligibility, active exchanges and cancellation history                    |
| POST       | /api/bookings/:id/cancel                | Participant; reason, idempotency_key UUID; policy and allocation checks; eligible full remaining sandbox refund |
| POST       | /api/exchanges/:id/cancellation         | Active participant; reason; proposal does not change schedule yet                                               |
| POST       | /api/exchange-cancellations/:id/respond | Participant; action accept/reject/cancel; proposer may withdraw, partner may accept/reject                      |
| GET        | /api/support/tickets                    | Owner's support requests                                                                                        |
| POST       | /api/support/tickets                    | Owner; subject (2–120), body (10–6000)                                                                          |
| GET        | /api/support/tickets/:id                | Owner or staff with support.read; private ticket/replies                                                        |
| POST       | /api/support/tickets/:id/replies        | Owner or staff with support.write; body (10–6000); unresolved only                                              |
| GET        | /api/admin/users                        | users.read; q, verification, suspended=true/false, page; 20 per page; students only, no hashes                  |
| POST       | /api/admin/users/:id/status             | users.write; suspended boolean, reason; student-only status control and session invalidation                    |
| GET / POST | /api/admin/categories                   | categories.read/write; create name, reason; archived records retained                                           |
| PUT        | /api/admin/categories/:id               | categories.write; name, active boolean, reason                                                                  |
| GET        | /api/admin/listings                     | listings.read; q title/mentor search, latest 200                                                                |
| POST       | /api/admin/listings/:id/moderate        | listings.write; status visible/hidden, reason; independent of owner status                                      |
| GET / PUT  | /api/admin/policies                     | policies.read/write; optimistic revision and fields below                                                       |
| GET / POST | /api/admin/announcements                | announcements.read/write; create title, body, audience public/students, published boolean, reason               |
| PUT        | /api/admin/announcements/:id            | announcements.write; same editable fields and reason                                                            |
| GET / POST | /api/admin/roles                        | roles.manage; list catalog or create key, label, permissions array, reason                                      |
| PUT        | /api/admin/roles/:key                   | roles.manage; label, permissions array, reason; recovery superadmin role immutable                              |
| GET / POST | /api/admin/administrators               | roles.manage; separate staff list or create name/email/password/admin_role/reason                               |
| PUT        | /api/admin/administrators/:id           | roles.manage; admin_role, suspended boolean, reason; no self-change/last-root removal                           |
| GET        | /api/admin/complaints                   | support.read; latest 200 support tickets and assignable support staff                                           |
| POST       | /api/admin/complaints/:id/status        | support.write; status open/in_progress/resolved, assigned_to integer/null, reason                               |
| POST       | /api/admin/exchanges/:id/terminate      | exchanges.write; reason; reviewed termination of pending/negotiating/active agreement, history retained         |
| GET        | /api/admin/reports                      | reports.read; actual stored totals and latest 12 monthly booking-creation counts                                |

## Permission model

The superadmin role has *. Other roles use a catalog of explicit read/write and file capabilities. Default verifier handles enrolment review/verification files; support handles student search, support, booking/exchange inspection and reviewed exchange termination; moderator handles categories/listings/reviews/portfolios/announcements and content files; finance handles sandbox payments/withdrawals/disputes and dispute evidence. Existing payment dispute helpers outside /api/admin also require dispute-read capability for staff. Financial assignment only permits active staff who can read/write disputes. Support assignment only permits active support writers.

Roles are loaded on every authenticated API request. Role-definition changes apply to existing staff sessions on the next request. Account status/administrator-role/password changes also increment session_version and expire persistent sessions. Password/status changes invalidate earlier reset links. Password reset and change use a consistent user-first lock order before token invalidation. Older pre-stage-6 sessions are interpreted as version 1 for migration compatibility.

Generic private-file access grants owners/related learning participants access as before; staff require files.verification, files.dispute or files.content for the corresponding stored file class. Superadmins retain full authorized review access. There is no staff API to enumerate private learning conversations. New staff passwords are hashed and are never returned by staff-list/create responses; no email is sent.

## Policy snapshots and discovery

PUT policies body: revision, commission_bps integer 0–10000, completion_response_hours 1–720, cancellation_notice_hours 0–168, registration_open boolean, listing_publication_open boolean, policy_text (20–10000), reason. Stale revisions return 409. Initially null database commission/response defaults inherit the existing configured environment values. Saving a policy establishes explicit database overrides.

New reservations snapshot cancellation notice and completion response hours. Successful payments snapshot commission basis points before provider-event processing. Old booking snapshots and funded allocation policies are not rewritten. Paused registration/publication is enforced server-side. Archived categories and administrator-hidden listings are excluded from discovery/detail/new booking and new checkout; the owner cannot unhide by editing. Old booking/financial history remains accessible to its participants.

## Cancellation and history

Self-service reservation cancellation requires reserved/scheduled and future start. Unpaid/free/legacy reservations may cancel before start. A learner with a funded held allocation must meet the booking's notice snapshot; the mentor may cancel before start with a full remaining simulated refund. On-hold/released/refunded allocations cannot use this path. Refund and cancellation history commit atomically, duplicates use the same operation key, and pending reschedule requests are superseded. Sandbox disablement prevents simulated cancellation refunds. No cancellation fee or real money operation is introduced.

The old unconditional slot uniqueness is replaced by one reserved booking per slot. A fully cancelled reservation's original future slot is discoverable and bookable again; old booking IDs/history remain. Rescheduling alone does not relist the old slot. The usual participant locking and reserved-only uniqueness still block duplicate active reservations.

Active reciprocal exchanges require mutual acceptance of a separate cancellation proposal; until then their schedule stays in force. Authorized support may terminate an outstanding exchange after reviewing a complaint and recording a reason. This cancels pending cancellation/reschedule requests, resolves open exchange reports with the decision, and retains each session/completion flag without fabricating delivery or moving money.

## Account privacy and support

profile_public=false hides public profile and portfolio metadata/files; it does not erase names from published listings or previously authored public reviews. Owner drafts are retained. Activity/reminder preferences control in-app display, not external email/push. Deactivation is denied while future/completion-pending reservations, active exchanges, held allocations, pending withdrawals or available earnings remain. Deactivation preserves records, hides public content and signs out sessions. Restoration is administrator-controlled.

Support is an in-app owner/reviewer conversation with status and reasoned resolution; resolved tickets reject new replies until reopened by authorized staff. Announcements are plain text, with explicit audience and draft/published state. Reports count real stored rows and do not imply live users, real funds or institutional endorsement. The admin CSV export contains only those computed summary metrics/monthly rows.
