# Stage 6 — five-minute administration walkthrough

All seed accounts and activity are fictional. Use a local isolated demo, not genuine student documents or real payment data.

0:00 — Sign in as verifier@skillswap.test with StudentDemo!2026. Show Verification queue/ID review and that finance/role controls are absent. Demonstrate a direct disallowed admin API returns 403. Switch to the root admin to inspect roles and separate staff accounts; student accounts are not promoted into staff accounts.

0:45 — As root, find a fictional student by name/email. Suspend and restore with a recorded reason. Show that an old session is invalidated while existing learning/payment history remains. Inspect the audit event.

1:25 — As moderator@skillswap.test, hide a listing or archive a category. The public marketplace no longer exposes it; the owner cannot override administrator hiding by editing. Restore only if its other eligibility/publication conditions permit.

2:00 — As root, open Policy settings. Save a new revision with a reason, then show public policies. Existing funded commission and booking cancellation/response snapshots stay intact; future bookings/funding use the new defaults. Registration/publication pauses are enforced by the backend.

2:40 — As a student, open Account & privacy. Hide the public profile/portfolio and toggle in-app activity/reminders; restore preferences afterwards. Password change requires the current password and signs out all old sessions and recovery links. Deactivation is blocked while obligations remain and does not delete history.

3:15 — Open Cancellations. An early learner paid cancellation or upcoming mentor cancellation refunds the remaining held sandbox allocation; late/disputed/released cases require support/review. Active reciprocal exchanges require mutual acceptance, while authorized support can terminate an unfulfilled agreement after review and record its reason.

4:00 — As support@skillswap.test, inspect the seeded student8 support ticket, reply in-app, assign and resolve with a reason. As moderator, create a public/student-only/draft announcement and verify audience visibility. As root, inspect reports and export summary CSV.

4:40 — Show the verification record: 95 automated checks passed. Three authored browser journeys have discovery/syntax checks but have not run here. The final planned stage covers full browser/mobile/operational testing, fixes and deployment setup.
