import "./test-environment.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { migrateDatabase } from "../server/migrations.js";
import { seed } from "../scripts/seed.js";
let db,
  app,
  storage,
  root,
  mentor,
  learner,
  other,
  verifier,
  finance,
  support,
  moderator,
  sequence = 0;
const password = "StudentDemo!2026",
  why =
    "Fictional administrator demonstration decision with a recorded reason.";
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
async function login(email, pass = password) {
  const agent = request.agent(app);
  let r = await agent.get("/api/auth/me");
  r = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", r.body.csrf)
    .send({ email, password: pass });
  assert.equal(r.status, 200);
  return { agent, csrf: r.body.csrf, user: r.body.user };
}
async function staff(role) {
  const email = role + "@admin-test.skillswap.test";
  const r = await post(root, "/admin/administrators", {
    name: "Demo " + role,
    email,
    password,
    admin_role: role,
    reason: why,
  });
  assert.equal(r.status, 201);
  assert.equal(Object.hasOwn(r.body.administrator, "password_hash"), false);
  return login(email);
}
async function reserve({ hours } = {}) {
  const starts = new Date(
    Date.now() + (hours ?? (30 + sequence++ * 2) * 24) * 3600000,
  );
  const s = await post(mentor, "/listings/1/slots", {
    starts_at: starts.toISOString(),
  });
  assert.equal(s.status, 201);
  const r = await post(learner, "/bookings", { slot_id: s.body.slot.id });
  assert.equal(r.status, 201);
  return r.body.booking;
}
async function pay(b) {
  const r = await post(learner, `/bookings/${b.id}/checkout`, {
    scenario: "success",
    idempotency_key: randomUUID(),
  });
  assert.equal(r.status, 201);
  return r;
}
before(async () => {
  db = new PGlite();
  await migrateDatabase(db);
  await seed(db);
  storage = await mkdtemp(path.join(os.tmpdir(), "admin-"));
  app = createApp({
    db,
    storageDir: storage,
    secret: "administration-test-session-secret-32-characters",
  });
  root = await login("admin@skillswap.test");
  mentor = await login("student1@skillswap.test");
  learner = await login("student3@skillswap.test");
  other = await login("student5@skillswap.test");
  verifier = await staff("verifier");
  finance = await staff("finance");
  support = await staff("support");
  moderator = await staff("moderator");
});
after(async () => {
  await db.close();
  if (storage) await rm(storage, { recursive: true, force: true });
});
test("administrator permissions guard every old and new route and are enforced outside the sidebar", async () => {
  assert.ok(root.user.permissions.includes("*"));
  assert.equal(
    (await verifier.agent.get("/api/admin/verifications")).status,
    200,
  );
  assert.equal((await verifier.agent.get("/api/admin/payments")).status, 403);
  assert.equal((await finance.agent.get("/api/admin/payments")).status, 200);
  assert.equal(
    (await finance.agent.get("/api/admin/verifications")).status,
    403,
  );
  assert.equal((await support.agent.get("/api/admin/users")).status, 200);
  assert.equal(
    (
      await post(support, `/admin/users/${learner.user.id}/status`, {
        suspended: true,
        reason: why,
      })
    ).status,
    403,
  );
  assert.equal((await moderator.agent.get("/api/admin/listings")).status, 200);
  assert.equal((await moderator.agent.get("/api/admin/roles")).status, 403);
  assert.equal(
    (await root.agent.get("/api/admin/unknown-operation")).status,
    403,
  );
  assert.equal((await learner.agent.get("/api/admin/reports")).status, 403);
});
test("role changes take effect on the next request, without self-role escalation or last-root removal", async () => {
  assert.equal(
    (
      await post(root, "/admin/roles", {
        key: "analyst",
        label: "Reports only",
        permissions: ["overview.read", "reports.read"],
        reason: why,
      })
    ).status,
    201,
  );
  const analyst = await staff("analyst");
  assert.equal((await analyst.agent.get("/api/admin/reports")).status, 200);
  assert.equal((await analyst.agent.get("/api/admin/users")).status, 403);
  assert.equal(
    (
      await put(root, "/admin/roles/analyst", {
        label: "No reports",
        permissions: ["overview.read"],
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal((await analyst.agent.get("/api/admin/reports")).status, 403);
  assert.equal(
    (
      await put(root, "/admin/roles/superadmin", {
        label: "Unsafe",
        permissions: [],
        reason: why,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await put(root, `/admin/administrators/${root.user.id}`, {
        admin_role: "verifier",
        suspended: true,
        reason: why,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await put(root, `/admin/administrators/${learner.user.id}`, {
        admin_role: "superadmin",
        suspended: false,
        reason: why,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post(root, "/admin/roles", {
        key: "wildcard",
        label: "Invalid wildcard",
        permissions: ["*"],
        reason: why,
      })
    ).status,
    400,
  );
});
test("private verification documents require the corresponding file permission", async () => {
  const student = await login("student8@skillswap.test");
  const r = await student.agent
    .post("/api/verification")
    .set("X-CSRF-Token", student.csrf)
    .attach(
      "document",
      Buffer.from("%PDF-1.4\nFictional enrolment evidence."),
      "student.pdf",
    );
  assert.equal(r.status, 201);
  const v = (await verifier.agent.get("/api/admin/verifications")).body
    .items[0];
  assert.equal(
    (await verifier.agent.get("/api/files/" + v.file_id)).status,
    200,
  );
  assert.equal(
    (await finance.agent.get("/api/files/" + v.file_id)).status,
    404,
  );
  assert.equal(
    (await moderator.agent.get("/api/files/" + v.file_id)).status,
    404,
  );
  assert.equal(
    (
      await post(verifier, "/admin/verifications/" + v.id, {
        status: "approved",
        reason: "Fictional enrolment document reviewed.",
      })
    ).status,
    200,
  );
});
test("student suspension and restoration invalidate stale sessions while retaining stored data", async () => {
  const stale = await login("student8@skillswap.test");
  assert.equal(
    (
      await post(root, `/admin/users/${stale.user.id}/status`, {
        suspended: true,
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get("/api/mentors/" + stale.user.id)).status,
    404,
  );
  assert.equal(
    (
      await post(root, `/admin/users/${stale.user.id}/status`, {
        suspended: false,
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal((await stale.agent.get("/api/auth/me")).status, 401);
  const fresh = await login("student8@skillswap.test");
  assert.equal(fresh.user.verification, "approved");
  const list = (
    await support.agent.get("/api/admin/users?q=student8&verification=approved")
  ).body;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].email, "student8@skillswap.test");
  assert.equal(Object.hasOwn(list.items[0], "password_hash"), false);
});
test("listing hiding and category archival cannot be bypassed by an owner edit or checkout", async () => {
  const l = (await request(app).get("/api/listings/1")).body.listing,
    b = await reserve();
  assert.equal(
    (
      await post(moderator, "/admin/listings/1/moderate", {
        status: "hidden",
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal((await request(app).get("/api/listings/1")).status, 404);
  const edit = {
    category_id: l.category_id,
    title: l.title,
    description: l.description,
    level: l.level,
    objectives: l.objectives,
    prerequisites: l.prerequisites,
    duration_minutes: l.duration_minutes,
    fee_minor: l.fee_minor,
    exchange_enabled: l.exchange_enabled,
    status: "published",
  };
  assert.equal(
    (await put(mentor, "/listings/1", edit)).body.listing.moderation_status,
    "hidden",
  );
  assert.equal(
    (
      await post(learner, `/bookings/${b.id}/checkout`, {
        scenario: "success",
        idempotency_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(moderator, "/admin/listings/1/moderate", {
        status: "visible",
        reason: why,
      })
    ).status,
    200,
  );
  const categories = (await moderator.agent.get("/api/admin/categories")).body
    .items;
  const category = categories.find((c) => c.id === l.category_id);
  assert.equal(
    (
      await put(moderator, "/admin/categories/" + category.id, {
        name: category.name,
        active: false,
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal((await request(app).get("/api/listings/1")).status, 404);
  assert.equal((await post(mentor, "/listings", edit)).status, 400);
  assert.equal(
    (
      await put(moderator, "/admin/categories/" + category.id, {
        name: category.name,
        active: true,
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal((await request(app).get("/api/listings/1")).status, 200);
  assert.equal(
    (
      await post(moderator, "/admin/categories", {
        name: category.name.toLowerCase(),
        reason: why,
      })
    ).status,
    409,
  );
  assert.equal(
    (await db.query("SELECT status FROM bookings WHERE id=$1", [b.id])).rows[0]
      .status,
    "reserved",
  );
});
test("policy revisions pause registration/publication and preserve prior booking/funding snapshots", async () => {
  const old = await reserve();
  await pay(old);
  const p = (await root.agent.get("/api/admin/policies")).body.policy;
  const update = {
    revision: p.revision,
    commission_bps: 2500,
    completion_response_hours: 24,
    cancellation_notice_hours: 48,
    registration_open: false,
    listing_publication_open: false,
    policy_text: p.policy_text,
    reason: why,
  };
  assert.equal((await put(root, "/admin/policies", update)).status, 200);
  assert.equal((await put(root, "/admin/policies", update)).status, 409);
  const stranger = request.agent(app),
    csrf = (await stranger.get("/api/auth/me")).body.csrf;
  assert.equal(
    (
      await stranger
        .post("/api/auth/register")
        .set("X-CSRF-Token", csrf)
        .send({
          name: "Paused Student",
          institution: "Fictional College",
          email: "paused@example.test",
          password,
          enrolled: true,
        })
    ).status,
    403,
  );
  const l = (await request(app).get("/api/listings/1")).body.listing;
  assert.equal(
    (
      await post(mentor, "/listings", {
        ...l,
        category_id: l.category_id,
        status: "published",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await db.query(
        "SELECT cancellation_notice_hours,completion_response_hours FROM bookings WHERE id=$1",
        [old.id],
      )
    ).rows[0].cancellation_notice_hours,
    24,
  );
  assert.equal(
    (
      await db.query(
        "SELECT commission_bps FROM payment_allocations WHERE booking_id=$1",
        [old.id],
      )
    ).rows[0].commission_bps,
    1000,
  );
  assert.equal(
    (
      await put(root, "/admin/policies", {
        ...update,
        revision: p.revision + 1,
        registration_open: true,
        listing_publication_open: true,
      })
    ).status,
    200,
  );
  const next = await reserve();
  assert.equal(next.cancellation_notice_hours, 48);
  assert.equal(next.completion_response_hours, 24);
  await pay(next);
  assert.equal(
    (
      await db.query(
        "SELECT commission_bps FROM payment_allocations WHERE booking_id=$1",
        [next.id],
      )
    ).rows[0].commission_bps,
    2500,
  );
  const latest = (await root.agent.get("/api/admin/policies")).body.policy;
  assert.equal(
    (
      await put(root, "/admin/policies", {
        ...update,
        revision: latest.revision,
        commission_bps: 1000,
        completion_response_hours: 72,
        cancellation_notice_hours: 24,
        registration_open: true,
        listing_publication_open: true,
      })
    ).status,
    200,
  );
});
test("privacy controls revoke profile and public portfolio access; notification preferences do not delete history", async () => {
  const student = await login("student6@skillswap.test");
  const entry = await student.agent
    .post("/api/portfolio")
    .set("X-CSRF-Token", student.csrf)
    .field("title", "Fictional public project")
    .field(
      "description",
      "A fictional project for demonstrating account privacy controls.",
    )
    .field("visibility", "public")
    .field("share_file", "true")
    .attach("work", Buffer.from("Fictional public work sample."), "work.txt");
  assert.equal(entry.status, 201);
  const portfolioId = entry.body.entry.id;
  await db.query(
    "INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,'Fictional update','dashboard/account','privacy-test')",
    [student.user.id],
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolioId}/file`)).status,
    200,
  );
  assert.equal(
    (
      await put(student, "/account/settings", {
        profile_public: false,
        notifications: { activity: false, session_reminders: false },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get("/api/mentors/" + student.user.id)).status,
    404,
  );
  assert.equal(
    (await request(app).get("/api/portfolio/" + portfolioId)).status,
    404,
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolioId}/file`)).status,
    404,
  );
  const hidden = (await student.agent.get("/api/notifications")).body;
  assert.equal(hidden.items.length, 0);
  assert.equal(hidden.unread, 0);
  assert.equal(
    (
      await put(student, "/account/settings", {
        profile_public: true,
        notifications: { activity: true, session_reminders: true },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get(`/api/portfolio/${portfolioId}/file`)).status,
    200,
  );
  assert.equal(
    (await student.agent.get("/api/notifications")).body.items.length,
    1,
  );
});
test("password changes verify the old password and revoke all old sessions", async () => {
  const a = await login("student7@skillswap.test"),
    stale = await login("student7@skillswap.test");
  assert.equal(
    (
      await post(a, "/account/password", {
        current_password: "wrong",
        new_password: "NewSecureDemo!2026",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(a, "/account/password", {
        current_password: password,
        new_password: "NewSecureDemo!2026",
      })
    ).status,
    200,
  );
  assert.equal((await stale.agent.get("/api/auth/me")).status, 401);
  assert.equal(
    (await login("student7@skillswap.test", "NewSecureDemo!2026")).user.id,
    a.user.id,
  );
});
test("deactivation retains history, hides public work and refuses unresolved commitments", async () => {
  assert.equal(
    (
      await post(mentor, "/account/deactivate", {
        current_password: password,
        reason: why,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(root, "/account/deactivate", {
        current_password: password,
        reason: why,
      })
    ).status,
    403,
  );
  const student = await login("student6@skillswap.test");
  assert.equal(
    (
      await post(student, "/account/deactivate", {
        current_password: password,
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get("/api/mentors/" + student.user.id)).status,
    404,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM portfolio_entries WHERE owner_id=$1",
        [student.user.id],
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await post(root, `/admin/users/${student.user.id}/status`, {
        suspended: false,
        reason: "Restored the fictional self-deactivated student after review.",
      })
    ).status,
    200,
  );
});
test("paid cancellation refunds once, preserves history and makes a future slot bookable again", async () => {
  const b = await reserve();
  await pay(b);
  const key = randomUUID(),
    body = {
      reason: "An early timetable change requires cancelling this reservation.",
      idempotency_key: key,
    };
  const result = await post(learner, `/bookings/${b.id}/cancel`, body);
  assert.equal(result.status, 200);
  assert.ok(result.body.cancellation.refund_id);
  assert.equal(
    (await post(learner, `/bookings/${b.id}/cancel`, body)).body.cancellation
      .id,
    result.body.cancellation.id,
  );
  const a = (
    await db.query("SELECT * FROM payment_allocations WHERE booking_id=$1", [
      b.id,
    ])
  ).rows[0];
  assert.equal(a.status, "refunded");
  assert.equal(a.refunded_minor, b.amount_minor);
  assert.equal(
    (
      await db.query("SELECT count(*) FROM refunds WHERE allocation_id=$1", [
        a.id,
      ])
    ).rows[0].count,
    1,
  );
  assert.ok(
    (await request(app).get("/api/listings/1")).body.slots.some(
      (s) => s.id === b.slot_id,
    ),
  );
  const replacement = await post(other, "/bookings", { slot_id: b.slot_id });
  assert.equal(replacement.status, 201);
  assert.notEqual(replacement.body.booking.id, b.id);
  assert.equal(
    (
      await db.query("SELECT count(*) FROM bookings WHERE slot_id=$1", [
        b.slot_id,
      ])
    ).rows[0].count,
    2,
  );
});
test("late funded learner cancellation is blocked but mentor cancellation returns the full remaining allocation", async () => {
  const b = await reserve({ hours: 2 });
  await pay(b);
  assert.equal(
    (
      await post(learner, `/bookings/${b.id}/cancel`, {
        reason: why,
        idempotency_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(mentor, `/bookings/${b.id}/cancel`, {
        reason:
          "The mentor cannot attend and provides a full simulated refund.",
        idempotency_key: randomUUID(),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db.query(
        "SELECT status FROM payment_allocations WHERE booking_id=$1",
        [b.id],
      )
    ).rows[0].status,
    "refunded",
  );
});
test("disputed allocations cannot be cancelled around the review; evidence and assignment permissions remain scoped", async () => {
  const b = await reserve();
  await pay(b);
  const d = (
    await post(learner, "/payment-disputes", {
      booking_id: b.id,
      category: "suspected_fraud",
      reason: "Fictional concern requiring an independent payment review.",
    })
  ).body.dispute;
  assert.equal(
    (
      await post(learner, `/bookings/${b.id}/cancel`, {
        reason: why,
        idempotency_key: randomUUID(),
      })
    ).status,
    409,
  );
  const ev = await learner.agent
    .post(`/api/payment-disputes/${d.id}/evidence`)
    .set("X-CSRF-Token", learner.csrf)
    .field("title", "Fictional evidence")
    .attach(
      "evidence",
      Buffer.from("Fictional payment review evidence."),
      "evidence.txt",
    );
  assert.equal(ev.status, 201);
  assert.equal(
    (await finance.agent.get("/api/files/" + ev.body.evidence.file_id)).status,
    200,
  );
  assert.equal(
    (await verifier.agent.get("/api/files/" + ev.body.evidence.file_id)).status,
    404,
  );
  assert.equal(
    (await verifier.agent.get("/api/payment-disputes/" + d.id)).status,
    403,
  );
  assert.equal(
    (
      await post(root, `/admin/payment-disputes/${d.id}/assign`, {
        admin_id: verifier.user.id,
        reason: why,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(root, `/admin/payment-disputes/${d.id}/assign`, {
        admin_id: finance.user.id,
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(finance, `/admin/payment-disputes/${d.id}/resolve`, {
        outcome: "refund",
        refund_minor: b.amount_minor,
        reason: "Fictional financial review authorizes a full refund.",
      })
    ).status,
    200,
  );
});
test("active exchange cancellation requires a separate bilateral decision and retains completion history", async () => {
  const partner = await login("student2@skillswap.test"),
    x = (await mentor.agent.get("/api/exchanges")).body.items.find(
      (x) => x.status === "active",
    );
  const before = Number(
    (
      await db.query(
        "SELECT count(*) FROM exchange_sessions WHERE exchange_id=$1",
        [x.id],
      )
    ).rows[0].count,
  );
  const first = await post(mentor, `/exchanges/${x.id}/cancellation`, {
    reason: why,
  });
  assert.equal(first.status, 201);
  assert.equal(
    (await post(mentor, `/exchanges/${x.id}/cancellation`, { reason: why }))
      .status,
    409,
  );
  assert.equal(
    (
      await post(
        mentor,
        `/exchange-cancellations/${first.body.request.id}/respond`,
        { action: "accept" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        other,
        `/exchange-cancellations/${first.body.request.id}/respond`,
        { action: "accept" },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(
        partner,
        `/exchange-cancellations/${first.body.request.id}/respond`,
        { action: "reject" },
      )
    ).status,
    200,
  );
  const second = await post(mentor, `/exchanges/${x.id}/cancellation`, {
    reason: why,
  });
  assert.equal(
    (
      await post(
        partner,
        `/exchange-cancellations/${second.body.request.id}/respond`,
        { action: "accept" },
      )
    ).status,
    200,
  );
  assert.equal(
    (await db.query("SELECT status FROM exchanges WHERE id=$1", [x.id])).rows[0]
      .status,
    "cancelled",
  );
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM exchange_sessions WHERE exchange_id=$1",
          [x.id],
        )
      ).rows[0].count,
    ),
    before,
  );
});
test("support requests are owner/reviewer scoped and resolution requires a recorded reason", async () => {
  const r = await post(learner, "/support/tickets", {
    subject: "Fictional timetable support",
    body: "I need help understanding the available scheduling options.",
  });
  assert.equal(r.status, 201);
  const ticket = r.body.ticket;
  assert.equal(
    (await other.agent.get("/api/support/tickets/" + ticket.id)).status,
    404,
  );
  assert.equal(
    (await verifier.agent.get("/api/support/tickets/" + ticket.id)).status,
    404,
  );
  assert.equal(
    (await support.agent.get("/api/support/tickets/" + ticket.id)).status,
    200,
  );
  assert.equal(
    (
      await post(support, `/support/tickets/${ticket.id}/replies`, {
        body: "Please inspect the session reschedule options in your learning room.",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(support, `/admin/complaints/${ticket.id}/status`, {
        status: "resolved",
        assigned_to: finance.user.id,
        reason: why,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(support, `/admin/complaints/${ticket.id}/status`, {
        status: "resolved",
        assigned_to: support.user.id,
        reason: why,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(learner, `/support/tickets/${ticket.id}/replies`, {
        body: "Late reply must be rejected after resolution.",
      })
    ).status,
    409,
  );
  assert.equal(
    (await learner.agent.get("/api/support/tickets/" + ticket.id)).body.replies
      .length,
    1,
  );
});
test("announcement audiences and actual stored report metrics are enforced", async () => {
  for (const [title, audience, published] of [
    ["Public update", "public", true],
    ["Student update", "students", true],
    ["Draft update", "public", false],
  ])
    assert.equal(
      (
        await post(moderator, "/admin/announcements", {
          title,
          body: "Fictional platform announcement for demonstration.",
          audience,
          published,
          reason: why,
        })
      ).status,
      201,
    );
  assert.equal(
    (await request(app).get("/api/announcements")).body.items.length,
    1,
  );
  assert.equal(
    (await learner.agent.get("/api/announcements")).body.items.length,
    2,
  );
  assert.equal(
    (await finance.agent.get("/api/admin/announcements")).status,
    403,
  );
  const report = (await root.agent.get("/api/admin/reports")).body;
  assert.equal(report.metrics.students, 8);
  assert.equal(
    report.metrics.reserved_bookings,
    Number(
      (await db.query("SELECT count(*) FROM bookings WHERE status='reserved'"))
        .rows[0].count,
    ),
  );
  assert.ok(
    (await root.agent.get("/api/admin/audit")).body.items.some(
      (a) => a.action === "policies.updated",
    ),
  );
});
test("delegated role management still cannot remove the last active superadministrator", async () => {
  assert.equal(
    (
      await post(root, "/admin/roles", {
        key: "accessmgr",
        label: "Delegated access manager",
        permissions: ["roles.manage"],
        reason: why,
      })
    ).status,
    201,
  );
  const manager = await staff("accessmgr");
  assert.equal(
    (
      await put(manager, `/admin/administrators/${root.user.id}`, {
        admin_role: "support",
        suspended: false,
        reason: why,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM users WHERE role='admin' AND admin_role='superadmin' AND suspended=false",
      )
    ).rows[0].count,
    1,
  );
});
test("authorized support can terminate an unfulfilled exchange after review without fabricating completion", async () => {
  const partner = await login("student6@skillswap.test");
  const requestResult = await post(other, "/exchanges", {
    recipient_id: partner.user.id,
    requester_skill: "english",
    recipient_skill: "spreadsheets",
    message: "A fictional reciprocal agreement for support resolution testing.",
  });
  assert.equal(requestResult.status, 201);
  const exchange = requestResult.body.exchange;
  assert.equal(
    (
      await post(partner, `/exchanges/${exchange.id}/respond`, {
        action: "accept",
      })
    ).status,
    200,
  );
  const start = new Date(Date.now() + 90 * 86400000);
  assert.equal(
    (
      await put(other, `/exchanges/${exchange.id}/agreement`, {
        revision: 0,
        requester_objective: "Practice practical spreadsheet skills.",
        recipient_objective: "Practice a clear English project explanation.",
        sessions: [
          {
            teacher_id: other.user.id,
            starts_at: start.toISOString(),
            duration_minutes: 30,
          },
          {
            teacher_id: partner.user.id,
            starts_at: new Date(start.getTime() + 86400000).toISOString(),
            duration_minutes: 30,
          },
        ],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(other, `/exchanges/${exchange.id}/accept-agreement`, {
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(partner, `/exchanges/${exchange.id}/accept-agreement`, {
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(verifier, `/admin/exchanges/${exchange.id}/terminate`, {
        reason: why,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(support, `/admin/exchanges/${exchange.id}/terminate`, {
        reason:
          "Fictional unfulfilled agreement reviewed and cancelled by support.",
      })
    ).status,
    200,
  );
  const sessions = (
    await db.query("SELECT * FROM exchange_sessions WHERE exchange_id=$1", [
      exchange.id,
    ])
  ).rows;
  assert.equal(sessions.length, 2);
  assert.ok(
    sessions.every((s) => !s.teacher_completed && !s.learner_confirmed),
  );
  assert.equal(
    (await db.query("SELECT status FROM exchanges WHERE id=$1", [exchange.id]))
      .rows[0].status,
    "cancelled",
  );
  assert.equal(
    (
      await post(support, `/admin/exchanges/${exchange.id}/terminate`, {
        reason: why,
      })
    ).status,
    409,
  );
});
test("password changes invalidate recovery links issued before the change", async () => {
  const student = await login("student4@skillswap.test");
  assert.equal(
    (await post(student, "/auth/recover", { email: student.user.email }))
      .status,
    200,
  );
  let mail;
  for (const file of await readdir(storage)) {
    if (file.startsWith("outbox-")) {
      const candidate = JSON.parse(
        await readFile(path.join(storage, file), "utf8"),
      );
      if (candidate.to === student.user.email) mail = candidate;
    }
  }
  assert.ok(mail);
  const token = mail.reset_url.split("token=")[1];
  assert.equal(
    (
      await post(student, "/account/password", {
        current_password: password,
        new_password: "ChangedSecureDemo!2026",
      })
    ).status,
    200,
  );
  const anonymous = request.agent(app),
    csrf = (await anonymous.get("/api/auth/me")).body.csrf;
  assert.equal(
    (
      await anonymous
        .post("/api/auth/reset")
        .set("X-CSRF-Token", csrf)
        .send({ token, password: "StaleTokenMustNotReset!2026" })
    ).status,
    400,
  );
  assert.equal(
    (await login("student4@skillswap.test", "ChangedSecureDemo!2026")).user.id,
    student.user.id,
  );
});
