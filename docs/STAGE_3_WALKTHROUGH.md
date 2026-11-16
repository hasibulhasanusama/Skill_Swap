> Historical checkpoint walkthrough. For current payment behavior use README.md and STAGE_4_WALKTHROUGH.md.

# Stage 3 — five-minute learning room walkthrough

0:00 — Sign in as student1@skillswap.test, password StudentDemo!2026. Open Messages & materials. The seeded active exchange with student2 contains two fictional conversation messages. Open the room and inspect the accepted exchange sessions.

0:45 — Send a message. Sign in as student2 in a separate browser profile/private window. Show the unread indicator and open the room to read the message. Refresh is explicit; this release does not claim real-time push delivery.

1:30 — Upload a fictional PDF, image or text learning material (max 5 MB). Download it as the other participant. Unrelated students cannot fetch the material. Student ID verification files remain separate and are not shared with learning partners.

2:15 — As the teacher for a session, save a genuine external HTTPS meeting link. Show that opening it does not mark attendance and does not create native video calling.

2:45 — Propose a new future time. Show that the current schedule stays unchanged. Switch to the other participant and accept the proposal. The server rechecks conflicts and records who accepted; the new time appears in both schedules.

3:45 — Inspect Notifications for reschedule/material updates and upcoming sessions within 24 hours. These are in-app notifications; email and push are not enabled.

4:15 — Explain attendance and completion. Participants can report their own attendance only after the session starts. For a reserved standard booking, after its end the mentor records delivery, then the learner confirms. The configurable response deadline does not automatically confirm a session or release money. Exchange completion remains bilateral for each teaching direction.

4:45 — Open the separate admin Session inspection page. Review delivery status, self-reported attendance and reschedule history without exposing message bodies. Mention that payments, portfolio projects and reviews remain later releases. Do not manipulate production data or the system clock to demonstrate completion; elapsed-time cases are verified in isolated API tests.
