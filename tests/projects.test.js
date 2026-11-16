import "./test-environment.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { migrateDatabase } from "../server/migrations.js";
import { seed } from "../scripts/seed.js";
let db,
  app,
  storage,
  mentor,
  learner,
  outsider,
  admin,
  partner,
  booking,
  task,
  first,
  second,
  portfolio,
  review;
const post = (a, url, body = {}) =>
  a.agent
    .post("/api" + url)
    .set("X-CSRF-Token", a.csrf)
    .send(body);
const put = (a, url, body) =>
  a.agent
    .put("/api" + url)
    .set("X-CSRF-Token", a.csrf)
    .send(body);
async function login(email) {
  const agent = request.agent(app);
  let r = await agent.get("/api/auth/me");
  r = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", r.body.csrf)
    .send({ email, password: "StudentDemo!2026" });
  assert.equal(r.status, 200);
  return { agent, csrf: r.body.csrf, user: r.body.user };
}
const taskBody = () => ({
  context_kind: "booking",
  context_id: booking.id,
  kind: "project",
  title: "Responsive study planner",
  instructions:
    "Build a responsive weekly study planner and explain your layout choices.",
  due_at: null,
});
const sendWork = (
  key,
  summary = "I built and tested a responsive planner with accessible labels.",
) =>
  learner.agent
    .post(`/api/projects/tasks/${task.id}/submissions`)
    .set("X-CSRF-Token", learner.csrf)
    .field("summary", summary)
    .field("external_url", "")
    .field("client_key", key)
    .attach(
      "work",
      Buffer.from("Fictional planner source and implementation notes."),
      "planner.txt",
    );
before(async () => {
  db = new PGlite();
  await migrateDatabase(db);
  await seed(db);
  storage = await mkdtemp(path.join(os.tmpdir(), "project-"));
  app = createApp({
    db,
    storageDir: storage,
    secret: "project-test-session-secret-32-characters",
  });
  mentor = await login("student1@skillswap.test");
  learner = await login("student3@skillswap.test");
  outsider = await login("student5@skillswap.test");
  partner = await login("student2@skillswap.test");
  admin = await login("admin@skillswap.test");
  const d = await request(app).get("/api/listings/1");
  const r = await post(learner, "/bookings", { slot_id: d.body.slots[0].id });
  assert.equal(r.status, 201);
  booking = r.body.booking;
});
after(async () => {
  await db.close();
  if (storage) await rm(storage, { recursive: true, force: true });
});
test("tasks require the real context teacher and funded paid bookings", async () => {
  assert.equal((await post(mentor, "/projects/tasks", taskBody())).status, 409);
  assert.equal(
    (await post(learner, "/projects/tasks", taskBody())).status,
    403,
  );
  assert.equal(
    (await post(outsider, "/projects/tasks", taskBody())).status,
    404,
  );
  assert.equal(
    (
      await post(learner, `/bookings/${booking.id}/checkout`, {
        scenario: "success",
        idempotency_key: randomUUID(),
      })
    ).status,
    201,
  );
  const r = await post(mentor, "/projects/tasks", taskBody());
  assert.equal(r.status, 201);
  task = r.body.task;
  assert.equal(task.learner_id, learner.user.id);
  assert.equal(
    (
      await post(mentor, "/projects/tasks", {
        ...taskBody(),
        due_at: "2020-01-01T00:00:00Z",
      })
    ).status,
    400,
  );
  assert.equal(
    (await outsider.agent.get(`/api/projects/tasks/${task.id}`)).status,
    404,
  );
  assert.equal(
    (await admin.agent.get(`/api/projects/tasks/${task.id}`)).status,
    404,
  );
  const contexts = (await mentor.agent.get("/api/projects/contexts")).body
    .items;
  assert.ok(
    contexts.some((c) => c.context_kind === "booking" && c.id === booking.id),
  );
  assert.equal(
    (await learner.agent.get("/api/projects/contexts")).body.items.some(
      (c) => c.context_kind === "booking" && c.id === booking.id,
    ),
    false,
  );
});
test("submissions persist private files, retry without duplicates and reject premature revisions", async () => {
  const key = randomUUID();
  const r = await sendWork(key);
  assert.equal(r.status, 201);
  first = r.body.submission;
  assert.equal(first.version, 1);
  const duplicate = await sendWork(key);
  assert.equal(duplicate.body.submission.id, first.id);
  assert.equal(
    (
      await sendWork(
        key,
        "Changed work must not reuse the original submission key.",
      )
    ).status,
    409,
  );
  assert.equal((await sendWork(randomUUID())).status, 409);
  assert.equal(
    (
      await post(mentor, `/projects/tasks/${task.id}/submissions`, {
        summary: "A teacher cannot submit as this learner.",
        external_url: "",
        client_key: randomUUID(),
      })
    ).status,
    403,
  );
  assert.equal(
    (await mentor.agent.get("/api/files/" + first.file_id)).status,
    200,
  );
  assert.equal(
    (await outsider.agent.get("/api/files/" + first.file_id)).status,
    404,
  );
  assert.equal(
    (await request(app).get("/api/files/" + first.file_id)).status,
    401,
  );
  assert.equal(
    (await mentor.agent.get("/api/projects/tasks")).body.progress
      .awaiting_my_feedback,
    1,
  );
});
test("feedback is mentor-only, creates a new resubmission version, and preserves old feedback", async () => {
  const body = {
    verdict: "changes_requested",
    comment:
      "Add a small-screen layout and describe the keyboard focus states.",
  };
  assert.equal(
    (await post(learner, `/project-submissions/${first.id}/feedback`, body))
      .status,
    403,
  );
  assert.equal(
    (await post(outsider, `/project-submissions/${first.id}/feedback`, body))
      .status,
    404,
  );
  assert.equal(
    (await post(mentor, `/project-submissions/${first.id}/feedback`, body))
      .status,
    200,
  );
  assert.equal(
    (await post(mentor, `/project-submissions/${first.id}/feedback`, body))
      .status,
    409,
  );
  const r = await sendWork(
    randomUUID(),
    "I added a small-screen layout and tested clear keyboard focus states.",
  );
  assert.equal(r.status, 201);
  second = r.body.submission;
  assert.equal(second.version, 2);
  assert.equal(
    (
      await post(mentor, `/project-submissions/${second.id}/feedback`, {
        verdict: "approved",
        comment:
          "The revised planner meets the task objectives and explains the choices clearly.",
      })
    ).status,
    200,
  );
  const detail = (await learner.agent.get(`/api/projects/tasks/${task.id}`))
    .body;
  assert.equal(detail.submissions.length, 2);
  assert.equal(detail.submissions[1].verdict, "changes_requested");
  assert.ok(detail.submissions[1].feedback.includes("small-screen"));
  assert.equal(detail.submissions[0].status, "approved");
  assert.equal((await sendWork(randomUUID())).status, 409);
  assert.equal(
    (await learner.agent.get("/api/projects/tasks")).body.progress.approved,
    1,
  );
});
test("approved portfolios are owner-controlled, private by default and do not share attachments implicitly", async () => {
  const body = {
    title: "My responsive study planner",
    description:
      "A fictional portfolio project showing responsive layout decisions and keyboard navigation.",
    external_url: "",
    share_file: false,
  };
  assert.equal(
    (await post(mentor, `/project-submissions/${second.id}/portfolio`, body))
      .status,
    404,
  );
  assert.equal(
    (await post(learner, `/project-submissions/${first.id}/portfolio`, body))
      .status,
    409,
  );
  const r = await post(
    learner,
    `/project-submissions/${second.id}/portfolio`,
    body,
  );
  assert.equal(r.status, 201);
  portfolio = r.body.entry;
  assert.equal(portfolio.visibility, "private");
  assert.equal(
    (await request(app).get("/api/portfolio/" + portfolio.id)).status,
    404,
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolio.id}/file`)).status,
    404,
  );
  assert.equal(
    (
      await put(outsider, "/portfolio/" + portfolio.id, {
        ...body,
        visibility: "public",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await put(learner, "/portfolio/" + portfolio.id, {
        ...body,
        visibility: "public",
      })
    ).status,
    200,
  );
  const publicEntry = (await request(app).get("/api/portfolio/" + portfolio.id))
    .body.entry;
  assert.equal(publicEntry.has_attachment, false);
  assert.equal(publicEntry.reviewed_project, true);
  assert.equal(Object.hasOwn(publicEntry, "file_id"), false);
  assert.equal(Object.hasOwn(publicEntry, "submission_id"), false);
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolio.id}/file`)).status,
    404,
  );
  assert.equal(
    (await request(app).get("/api/files/" + second.file_id)).status,
    401,
  );
});
test("explicit file publication, unpublishing and moderation immediately revoke public routes", async () => {
  const body = {
    title: portfolio.title,
    description: portfolio.description,
    external_url: "",
    share_file: true,
    visibility: "public",
  };
  assert.equal(
    (await put(learner, "/portfolio/" + portfolio.id, body)).status,
    200,
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolio.id}/file`)).status,
    200,
  );
  let profile = (await request(app).get("/api/mentors/" + learner.user.id))
    .body;
  assert.equal(profile.portfolio.length, 1);
  assert.equal(
    (
      await post(learner, `/admin/portfolios/${portfolio.id}/moderate`, {
        status: "hidden",
        reason: "A student cannot moderate public content.",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(admin, `/admin/portfolios/${portfolio.id}/moderate`, {
        status: "hidden",
        reason:
          "Temporarily hidden for fictional demonstration content review.",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get("/api/portfolio/" + portfolio.id)).status,
    404,
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolio.id}/file`)).status,
    404,
  );
  assert.equal(
    (await put(learner, "/portfolio/" + portfolio.id, body)).body.entry
      .moderation_status,
    "hidden",
  );
  assert.equal(
    (
      await post(admin, `/admin/portfolios/${portfolio.id}/moderate`, {
        status: "visible",
        reason: "Content review completed; owner visibility still applies.",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await put(learner, "/portfolio/" + portfolio.id, {
        ...body,
        visibility: "private",
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolio.id}/file`)).status,
    404,
  );
  await db.query("UPDATE users SET verification='unverified' WHERE id=$1", [
    learner.user.id,
  ]);
  assert.equal(
    (await put(learner, "/portfolio/" + portfolio.id, body)).status,
    403,
  );
  assert.equal(
    (
      await put(learner, "/portfolio/" + portfolio.id, {
        ...body,
        visibility: "private",
      })
    ).status,
    200,
  );
  await db.query("UPDATE users SET verification='approved' WHERE id=$1", [
    learner.user.id,
  ]);
});
test("independent portfolio uploads stay distinct from mentor-reviewed work and reject unsafe URLs", async () => {
  const invalid = await learner.agent
    .post("/api/portfolio")
    .set("X-CSRF-Token", learner.csrf)
    .field("title", "Unsafe work link")
    .field("description", "This description is long enough for the test.")
    .field("external_url", "javascript:alert(1)")
    .field("share_file", "false");
  assert.equal(invalid.status, 400);
  const r = await learner.agent
    .post("/api/portfolio")
    .set("X-CSRF-Token", learner.csrf)
    .field("title", "Independent project")
    .field(
      "description",
      "A fictional independent project without a mentor approval claim.",
    )
    .field("external_url", "")
    .field("share_file", "true")
    .field("visibility", "public")
    .attach(
      "work",
      Buffer.from("Fictional independent work sample."),
      "sample.txt",
    );
  assert.equal(r.status, 201);
  assert.equal(
    (await request(app).get("/api/portfolio/" + r.body.entry.id)).body.entry
      .reviewed_project,
    false,
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${r.body.entry.id}/file`)).status,
    200,
  );
  assert.equal(
    (await request(app).get("/api/files/" + r.body.entry.file_id)).status,
    401,
  );
});
test("saved skills are persistent, owned, idempotent and hide inactive listings", async () => {
  assert.equal((await post(learner, "/saved-skills/1")).status, 200);
  assert.equal((await post(learner, "/saved-skills/1")).status, 200);
  assert.equal(
    (await learner.agent.get("/api/saved-skills")).body.items.length,
    1,
  );
  assert.equal(
    (await outsider.agent.get("/api/saved-skills")).body.items.length,
    0,
  );
  await db.query("UPDATE listings SET status='inactive' WHERE id=1");
  assert.equal(
    (await learner.agent.get("/api/saved-skills")).body.items.length,
    0,
  );
  await db.query("UPDATE listings SET status='published' WHERE id=1");
  assert.equal(
    (
      await learner.agent
        .delete("/api/saved-skills/1")
        .set("X-CSRF-Token", learner.csrf)
    ).status,
    200,
  );
  assert.equal(
    (await learner.agent.get("/api/saved-skills")).body.items.length,
    0,
  );
});
test("booking reviews require actual learner-confirmed completion and derive the target server-side", async () => {
  const body = {
    context_kind: "booking",
    context_id: booking.id,
    rating: 5,
    comment:
      "The Student Mentor provided clear practical guidance and useful project feedback.",
    subject_id: learner.user.id,
  };
  assert.equal((await post(learner, "/reviews", body)).status, 403);
  assert.equal((await post(outsider, "/reviews", body)).status, 404);
  await db.query(
    "UPDATE bookings SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=$1",
    [booking.id],
  );
  assert.equal(
    (await post(mentor, `/bookings/${booking.id}/complete`)).status,
    200,
  );
  assert.equal((await post(learner, "/reviews", body)).status, 403);
  assert.equal(
    (await post(learner, `/bookings/${booking.id}/confirm`)).status,
    200,
  );
  assert.equal((await post(mentor, "/reviews", body)).status, 403);
  assert.equal(
    (await post(learner, "/reviews", { ...body, rating: 6 })).status,
    400,
  );
  const r = await post(learner, "/reviews", body);
  assert.equal(r.status, 201);
  review = r.body.review;
  assert.equal(review.subject_id, mentor.user.id);
  assert.notEqual(review.author_id, review.subject_id);
  assert.equal((await post(learner, "/reviews", body)).status, 409);
  const profile = (await request(app).get("/api/mentors/" + mentor.user.id))
    .body;
  assert.equal(profile.statistics.review_count, 1);
  assert.equal(profile.statistics.average_rating, 5);
  assert.equal(profile.statistics.completed_sessions, 1);
  assert.equal(profile.reviews[0].author_name, learner.user.name);
});
test("review moderation and loss of completion eligibility update public averages without deleting history", async () => {
  assert.equal(
    (
      await post(admin, `/admin/reviews/${review.id}/moderate`, {
        status: "hidden",
        reason: "Fictional moderation hides a review from public calculations.",
      })
    ).status,
    200,
  );
  let profile = (await request(app).get("/api/mentors/" + mentor.user.id)).body;
  assert.equal(profile.statistics.review_count, 0);
  assert.equal(profile.statistics.average_rating, null);
  assert.equal(profile.reviews.length, 0);
  assert.equal(
    (await learner.agent.get("/api/reviews")).body.issued[0].moderation_status,
    "hidden",
  );
  assert.equal(
    (
      await post(admin, `/admin/reviews/${review.id}/moderate`, {
        status: "visible",
        reason: "Review restored after the demonstration content check.",
      })
    ).status,
    200,
  );
  await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [
    booking.id,
  ]);
  profile = (await request(app).get("/api/mentors/" + mentor.user.id)).body;
  assert.equal(profile.statistics.review_count, 0);
  assert.equal(
    (await learner.agent.get("/api/reviews")).body.issued[0].eligible_now,
    false,
  );
  assert.equal(
    (await admin.agent.get("/api/admin/reviews")).body.items.length,
    1,
  );
  assert.ok(
    (await admin.agent.get("/api/admin/audit")).body.items.some(
      (x) => x.action === "reviews.hidden",
    ),
  );
});
test("reciprocal exchange reviews require confirmed work in both directions", async () => {
  const x = (await mentor.agent.get("/api/exchanges")).body.items.find(
    (x) => x.status === "active",
  );
  const body = {
    context_kind: "exchange",
    context_id: x.id,
    rating: 4,
    comment:
      "We both practiced our agreed skills and confirmed each session independently.",
  };
  assert.equal((await post(mentor, "/reviews", body)).status, 403);
  await db.query("UPDATE exchanges SET status='completed' WHERE id=$1", [x.id]);
  assert.equal((await post(mentor, "/reviews", body)).status, 403);
  await db.query(
    "UPDATE exchange_sessions SET teacher_completed=true,learner_confirmed=true WHERE exchange_id=$1",
    [x.id],
  );
  assert.equal((await post(mentor, "/reviews", body)).status, 201);
  assert.equal((await post(partner, "/reviews", body)).status, 201);
  assert.equal((await post(mentor, "/reviews", body)).status, 409);
  assert.equal(
    (await request(app).get("/api/mentors/" + partner.user.id)).body.statistics
      .review_count,
    1,
  );
  assert.equal(
    (await request(app).get("/api/mentors/" + mentor.user.id)).body.statistics
      .completed_sessions,
    1,
  );
});
test("exchange teaching tasks work independently in each teaching direction and private submissions reject invalid files", async () => {
  const x = (await mentor.agent.get("/api/exchanges")).body.items.find(
    (x) => x.status === "completed",
  );
  const body = {
    context_kind: "exchange",
    context_id: x.id,
    kind: "exercise",
    title: "Prepare a clear project presentation",
    instructions:
      "Write and practice a short project presentation with a clear beginning and conclusion.",
  };
  const r = await post(partner, "/projects/tasks", body);
  assert.equal(r.status, 201);
  assert.equal(r.body.task.learner_id, mentor.user.id);
  const invalid = await mentor.agent
    .post(`/api/projects/tasks/${r.body.task.id}/submissions`)
    .set("X-CSRF-Token", mentor.csrf)
    .field("summary", "This would be an invalid executable attachment.")
    .field("external_url", "")
    .field("client_key", randomUUID())
    .attach("work", Buffer.from([0, 255, 1]), "unsafe.txt");
  assert.equal(invalid.status, 400);
  const result = await post(
    mentor,
    `/projects/tasks/${r.body.task.id}/submissions`,
    {
      summary:
        "I prepared and practiced a clear three-part project presentation.",
      external_url: "",
      client_key: randomUUID(),
    },
  );
  assert.equal(result.status, 201);
  assert.equal(
    (
      await post(
        partner,
        `/project-submissions/${result.body.submission.id}/feedback`,
        {
          verdict: "approved",
          comment:
            "The three-part explanation is clear and matches the agreed exercise.",
        },
      )
    ).status,
    200,
  );
});
