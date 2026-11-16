# Stage 7 implementation checklist

Version 0.6.0 contains cumulative stages 1–6. Sandbox money remains simulated. Browser/operational verification is still a separate final stage.

| Area                        | Current implementation                                                                                                                                  | Verification / limit                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Prior platform features     | Auth/ID review, marketplace, scheduling, exchanges, private rooms, projects, portfolio, eligible reviews and sandbox finance retained                   | Prior regression tests passing                                               |
| Administrator authorization | Current role permission checked at every admin API; unknown admin operations denied; role-specific file access                                          | API matrix and direct-route tests                                            |
| Roles/separate staff        | Create/edit restricted roles, separate staff accounts, self-change denial, last-root protection                                                         | API tests; no student promotion                                              |
| Student account management  | Search/filter/pagination, suspend/restore with reason, session/recovery-link revocation                                                                 | API tests; history retained                                                  |
| Account security/privacy    | Current-password change, session versions, prior reset-link invalidation, guarded deactivation, profile/portfolio hiding, activity/reminder preferences | API and DOM tests                                                            |
| Category/listing controls   | Create/rename/archive categories, independent hide/restore listings; owner cannot bypass hidden status                                                  | API tests; existing bookings retained                                        |
| Policy settings             | Optimistic revision, fee/response/cancellation defaults, registration/publication pause, public policy text                                             | API and DOM tests; old snapshots preserved                                   |
| Cancellation/refunds        | Upcoming free/legacy/unpaid cancellation, paid cutoff/mentor full refund, idempotency, restored future-slot availability                                | API and DOM tests; disputed/released cases require review                    |
| Active exchange exit        | Mutual cancellation or authorized reasoned support termination, retained session history                                                                | API tests; no fabricated completion                                          |
| Support                     | Private owner/staff ticket/reply/status/assignment/resolution                                                                                           | API tests; in-app only                                                       |
| Announcements               | Public/student audience, drafts, edit/publication control                                                                                               | API audience tests; no external sending                                      |
| Reports                     | Actual database metrics/monthly reservations and CSV export UI                                                                                          | API totals verified; browser download not executed here                      |
| Administration demo         | Repeatable restricted staff accounts, fictional announcement and support request                                                                        | Dedicated seed test                                                          |
| Upgrade                     | First five migrations unchanged; added columns/tables and reserved-only slot uniqueness                                                                 | Existing migration/upgrade tests; Windows execution unverified               |
| Browser E2E                 | Three authored journeys, including restricted staff and support resolution                                                                              | Discovery/syntax only; not executed                                          |
| Final deployment/operations | Setup/bootstrap/health, Docker files, disposable QA fixture and backup/restore guide delivered                                                          | Browser launch blocked; standalone PG, restore and deployment checks pending |

96 executed tests passed: 70 API/provider, 17 DOM interface, 2 migration, 3 upgrade and 3 seed tests, plus 1 operations test. The browser journeys are not counted as passed. See VERIFICATION.md.

## Remaining acceptance checks

Run complete user journeys through a real browser, inspect responsive behavior and accessibility, verify persistent sessions and competing writes against standalone PostgreSQL where available, exercise backup/restore and deployment configuration, and fix observed failures. Report any environment limits and exact remaining blockers rather than treating discovery or API-only tests as proof of a finished production deployment.

Real money, genuine escrow, external email/push, native video and an external object-store provider are not claimed. The original requested competition demo uses the implemented sandbox/local adapters; real provider integration remains optional future work.
