import "./test-environment.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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
  exchange;
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
const room = () => `/learning/booking/${booking.id}`;
before(async () => {
  process.env.DEMO_ENABLED = "true";
  db = new PGlite();
  await migrateDatabase(db);
  await seed(db);
  storage = await mkdtemp(path.join(os.tmpdir(), "learning-"));
  app = createApp({
    db,
    storageDir: storage,
    secret: "learning-test-secret-at-least-32-characters",
  });
  mentor = await login("student1@skillswap.test");
  learner = await login("student3@skillswap.test");
  outsider = await login("student5@skillswap.test");
  partner = await login("student2@skillswap.test");
  admin = await login("admin@skillswap.test");
  const listing = (await request(app).get("/api/listings")).body.items.find(
    (l) => l.mentor_id === mentor.user.id,
  );
  const slot = (await request(app).get("/api/listings/" + listing.id)).body
    .slots[0];
  const r = await post(learner, "/bookings", { slot_id: slot.id });
  assert.equal(r.status, 201);
  booking = r.body.booking;
  await db.query("UPDATE bookings SET payment_required=false WHERE id=$1", [
    booking.id,
  ]); // Exercise unchanged legacy Stage 3 reservations.
  exchange = (await mentor.agent.get("/api/exchanges")).body.items.find(
    (x) => x.status === "active",
  );
});
after(async () => {
  await db.close();
  if (storage) await rm(storage, { recursive: true, force: true });
});
test("all migrations upgrade existing records and repeat without data loss", async () => {
  assert.deepEqual(await migrateDatabase(db), []);
  assert.equal(
    (await db.query("SELECT name FROM users WHERE id=$1", [learner.user.id]))
      .rows[0].name,
    learner.user.name,
  );
  assert.equal(
    (await db.query("SELECT count(*) FROM schema_migrations")).rows[0].count,
    6,
  );
  assert.equal(
    (
      await db.query("SELECT learning_status FROM bookings WHERE id=$1", [
        booking.id,
      ])
    ).rows[0].learning_status,
    "scheduled",
  );
});
test("learning rooms and conversations enforce participant access, including administrator privacy", async () => {
  assert.equal((await learner.agent.get("/api" + room())).status, 200);
  assert.equal((await mentor.agent.get("/api" + room())).status, 200);
  assert.equal((await outsider.agent.get("/api" + room())).status, 404);
  assert.equal((await admin.agent.get("/api" + room())).status, 404);
  assert.equal((await request(app).get("/api" + room())).status, 401);
  const contexts = (await learner.agent.get("/api/learning/contexts")).body
    .items;
  assert.ok(contexts.some((x) => x.id === booking.id && x.kind === "booking"));
  assert.equal(
    (await outsider.agent.get("/api/learning/contexts")).body.items.some(
      (x) => x.kind === "booking" && x.id === booking.id,
    ),
    false,
  );
});
test("messages persist, retries are idempotent and unread indicators are recipient-specific", async () => {
  const client_key = randomUUID();
  const first = await post(learner, room() + "/messages", {
    body: "Can we work through a responsive layout?",
    client_key,
  });
  assert.equal(first.status, 201);
  const repeat = await post(learner, room() + "/messages", {
    body: "Can we work through a responsive layout?",
    client_key,
  });
  assert.equal(repeat.body.message.id, first.body.message.id);
  assert.equal(
    (
      await post(learner, room() + "/messages", {
        body: "Changed content under the same key.",
        client_key,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(outsider, room() + "/messages", {
        body: "Unauthorized message.",
        client_key: randomUUID(),
      })
    ).status,
    404,
  );
  let contexts = (await mentor.agent.get("/api/learning/contexts")).body.items;
  assert.equal(
    contexts.find((x) => x.kind === "booking" && x.id === booking.id).unread,
    1,
  );
  assert.equal(
    (await mentor.agent.get("/api" + room() + "/messages")).body.items[0].body,
    "Can we work through a responsive layout?",
  );
  assert.equal(
    (
      await post(mentor, room() + "/read", {
        through_id: first.body.message.id,
      })
    ).status,
    200,
  );
  contexts = (await mentor.agent.get("/api/learning/contexts")).body.items;
  assert.equal(
    contexts.find((x) => x.kind === "booking" && x.id === booking.id).unread,
    0,
  );
  assert.equal(
    (await mentor.agent.get("/api" + room() + "/messages?before=invalid"))
      .status,
    400,
  );
});
test("message history paginates without exposing unrelated conversations", async () => {
  for (let i = 0; i < 102; i++)
    await db.query(
      "INSERT INTO learning_messages(booking_id,sender_id,body,client_key) VALUES($1,$2,$3,$4)",
      [booking.id, learner.user.id, "History message " + i, randomUUID()],
    );
  const recent = (await mentor.agent.get("/api" + room() + "/messages")).body;
  assert.equal(recent.items.length, 100);
  assert.equal(recent.has_more, true);
  const older = (
    await mentor.agent.get(
      "/api" + room() + "/messages?before=" + recent.items[0].id,
    )
  ).body;
  assert.equal(older.items.length, 3);
  assert.equal(older.has_more, false);
  assert.equal(
    recent.items.some((x) => older.items.some((y) => y.id === x.id)),
    false,
  );
});
test("private materials download for participants only and unsafe uploads fail", async () => {
  const r = await learner.agent
    .post("/api" + room() + "/materials")
    .set("X-CSRF-Token", learner.csrf)
    .field("title", "Responsive layout notes")
    .attach(
      "material",
      Buffer.from("Practice CSS grid and explain your choices."),
      { filename: "notes.txt", contentType: "text/plain" },
    );
  assert.equal(r.status, 201);
  const fileId = r.body.material.file_id;
  assert.equal((await mentor.agent.get("/api/files/" + fileId)).status, 200);
  assert.equal((await outsider.agent.get("/api/files/" + fileId)).status, 404);
  assert.equal((await request(app).get("/api/files/" + fileId)).status, 401);
  assert.equal(
    (await learner.agent.get("/api/files/" + fileId)).headers["cache-control"],
    "no-store",
  );
  const materials = (await mentor.agent.get("/api" + room())).body.materials;
  assert.equal(materials[0].title, "Responsive layout notes");
  assert.equal(
    (
      await learner.agent
        .post("/api" + room() + "/materials")
        .set("X-CSRF-Token", learner.csrf)
        .field("title", "Unsafe binary")
        .attach("material", Buffer.from([0, 255, 1]), "bad.txt")
    ).status,
    400,
  );
  assert.equal(
    (
      await learner.agent
        .post("/api" + room() + "/materials")
        .set("X-CSRF-Token", learner.csrf)
        .field("title", "Not a PDF")
        .attach("material", Buffer.from("<script>bad</script>"), "bad.pdf")
    ).status,
    400,
  );
  assert.equal(
    (
      await outsider.agent
        .post("/api" + room() + "/materials")
        .set("X-CSRF-Token", outsider.csrf)
        .field("title", "Unauthorized upload")
        .attach("material", Buffer.from("No access."), "notes.txt")
    ).status,
    404,
  );
});
test("only the session teacher can save valid external meeting links; attendance is not inferred", async () => {
  const url = `/learning-sessions/booking/${booking.id}/meeting`;
  assert.equal(
    (
      await put(learner, url, {
        meeting_url: "https://meet.example.com/demo-room",
      })
    ).status,
    403,
  );
  assert.equal(
    (await put(mentor, url, { meeting_url: "javascript:alert(1)" })).status,
    400,
  );
  assert.equal(
    (
      await put(mentor, url, {
        meeting_url: "https://user:password@example.com/room",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await put(mentor, url, {
        meeting_url: "https://meet.example.com/demo-room",
      })
    ).status,
    200,
  );
  const d = (await learner.agent.get("/api" + room())).body;
  assert.equal(d.sessions[0].meeting_url, "https://meet.example.com/demo-room");
  assert.equal(d.attendance.length, 0);
  assert.equal(
    (
      await post(
        learner,
        `/learning-sessions/booking/${booking.id}/attendance`,
        { status: "present" },
      )
    ).status,
    409,
  );
});
test("rescheduling preserves the original time until the other participant accepts", async () => {
  const original = booking.starts_at,
    newTime = new Date(Date.parse(original) + 10 * 86400000).toISOString();
  const r = await post(
    learner,
    `/learning-sessions/booking/${booking.id}/reschedules`,
    {
      starts_at: newTime,
      reason: "A university assessment conflicts with this session.",
    },
  );
  assert.equal(r.status, 201);
  const id = r.body.reschedule.id;
  assert.equal(
    new Date(
      (await learner.agent.get("/api" + room())).body.sessions[0].starts_at,
    ).toISOString(),
    new Date(original).toISOString(),
  );
  assert.equal(
    (
      await post(
        learner,
        `/learning-sessions/booking/${booking.id}/reschedules`,
        { starts_at: newTime, reason: "A duplicate request should fail." },
      )
    ).status,
    409,
  );
  assert.equal(
    (await post(learner, `/reschedules/${id}/respond`, { action: "accept" }))
      .status,
    403,
  );
  assert.equal(
    (await post(outsider, `/reschedules/${id}/respond`, { action: "accept" }))
      .status,
    404,
  );
  assert.equal(
    (await post(mentor, `/reschedules/${id}/respond`, { action: "accept" }))
      .status,
    200,
  );
  let d = (await learner.agent.get("/api" + room())).body;
  assert.equal(new Date(d.sessions[0].starts_at).toISOString(), newTime);
  assert.equal(d.sessions[0].amount_minor, booking.amount_minor);
  assert.equal(d.sessions[0].slot_id, booking.slot_id);
  assert.equal(
    (await post(mentor, `/reschedules/${id}/respond`, { action: "accept" }))
      .status,
    409,
  );
  booking.starts_at = newTime;
});
test("reschedule acceptance rechecks conflicts introduced after proposal and rejection preserves schedule", async () => {
  const original = booking.starts_at,
    newTime = new Date(Date.parse(original) + 3 * 86400000).toISOString();
  const r = await post(
    learner,
    `/learning-sessions/booking/${booking.id}/reschedules`,
    { starts_at: newTime, reason: "Please move our practice to another day." },
  );
  assert.equal(r.status, 201);
  const l = (
    await db.query("SELECT * FROM listings WHERE mentor_id=$1 LIMIT 1", [
      outsider.user.id,
    ])
  ).rows[0];
  const end = new Date(Date.parse(newTime) + 3600000).toISOString();
  const slot = (
    await db.query(
      "INSERT INTO availability(listing_id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING id",
      [l.id, newTime, end],
    )
  ).rows[0];
  await db.query(
    "INSERT INTO bookings(learner_id,mentor_id,listing_id,slot_id,starts_at,ends_at,amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      learner.user.id,
      outsider.user.id,
      l.id,
      slot.id,
      newTime,
      end,
      l.fee_minor,
    ],
  );
  assert.equal(
    (
      await post(mentor, `/reschedules/${r.body.reschedule.id}/respond`, {
        action: "accept",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(mentor, `/reschedules/${r.body.reschedule.id}/respond`, {
        action: "reject",
      })
    ).status,
    200,
  );
  assert.equal(
    new Date(
      (await learner.agent.get("/api" + room())).body.sessions[0].starts_at,
    ).toISOString(),
    original,
  );
});
test("exchange reschedules check other sessions in the same agreement and preserve bilateral progress", async () => {
  const s = exchange.sessions[0],
    other = exchange.sessions[1];
  assert.equal(
    (
      await post(
        mentor,
        `/learning-sessions/exchange-session/${s.id}/reschedules`,
        {
          starts_at: new Date(
            Date.parse(other.starts_at) + 60000,
          ).toISOString(),
          reason: "This proposal overlaps the other exchange session.",
        },
      )
    ).status,
    409,
  );
  const proposed = new Date(
    Date.parse(s.starts_at) + 20 * 86400000,
  ).toISOString();
  const r = await post(
    mentor,
    `/learning-sessions/exchange-session/${s.id}/reschedules`,
    {
      starts_at: proposed,
      reason: "Move the session to an agreed alternative day.",
    },
  );
  assert.equal(r.status, 201);
  assert.equal(
    (
      await post(partner, `/reschedules/${r.body.reschedule.id}/respond`, {
        action: "accept",
      })
    ).status,
    200,
  );
  const current = (
    await mentor.agent.get(`/api/learning/exchange/${exchange.id}`)
  ).body;
  assert.equal(current.record.revision, exchange.revision + 1);
  assert.equal(current.record.requester_accepted, true);
  assert.equal(
    new Date(
      current.sessions.find((x) => x.id === s.id).starts_at,
    ).toISOString(),
    proposed,
  );
  assert.equal(
    (
      await post(mentor, `/learning/exchange/${exchange.id}/messages`, {
        body: "We agreed on our new time.",
        client_key: randomUUID(),
      })
    ).status,
    201,
  );
});
test("attendance is self-reported, completion requires delivery then learner confirmation, and no funds move", async () => {
  assert.equal(
    (await post(mentor, `/bookings/${booking.id}/complete`)).status,
    409,
  );
  assert.equal(
    (await post(learner, `/bookings/${booking.id}/confirm`)).status,
    409,
  );
  await db.query(
    "UPDATE bookings SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=$1",
    [booking.id],
  );
  assert.equal(
    (
      await post(
        outsider,
        `/learning-sessions/booking/${booking.id}/attendance`,
        { status: "present" },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(
        learner,
        `/learning-sessions/booking/${booking.id}/attendance`,
        { status: "present", note: "Completed the guided exercise." },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        learner,
        `/learning-sessions/booking/${booking.id}/attendance`,
        { status: "absent", note: "Correcting my attendance statement." },
      )
    ).status,
    200,
  );
  assert.equal(
    (await post(learner, `/bookings/${booking.id}/complete`)).status,
    403,
  );
  assert.equal(
    (await post(mentor, `/bookings/${booking.id}/complete`)).status,
    200,
  );
  let d = (await learner.agent.get("/api" + room())).body;
  assert.equal(d.sessions[0].learning_status, "completion_pending");
  assert.ok(d.sessions[0].confirmation_due_at);
  assert.equal(d.attendance.length, 1);
  assert.equal(d.attendance[0].status, "absent");
  assert.equal(
    (await post(mentor, `/bookings/${booking.id}/complete`)).status,
    409,
  );
  assert.equal(
    (await post(mentor, `/bookings/${booking.id}/confirm`)).status,
    403,
  );
  await db.query(
    "UPDATE bookings SET confirmation_due_at=now()-interval '1 hour' WHERE id=$1",
    [booking.id],
  );
  assert.equal(
    (await learner.agent.get("/api" + room())).body.record.learning_status,
    "completion_pending",
  );
  assert.equal(
    (await post(learner, `/bookings/${booking.id}/confirm`)).status,
    200,
  );
  assert.equal(
    (await post(learner, `/bookings/${booking.id}/confirm`)).status,
    409,
  );
  assert.equal(
    (await learner.agent.get("/api" + room())).body.record.learning_status,
    "completed",
  );
  assert.equal(
    (
      await post(learner, room() + "/messages", {
        body: "Read-only room after completion.",
        client_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (await mentor.agent.get("/api" + room() + "/messages")).status,
    200,
  );
  assert.equal(
    (await db.query("SELECT count(*) FROM payments")).rows[0].count,
    0,
  );
});
test("notifications and administrator inspection are protected and outcomes are audited", async () => {
  const d = (await learner.agent.get("/api/notifications")).body;
  assert.ok(d.items.some((n) => n.title.includes("reschedule")));
  assert.ok(d.unread > 0);
  const item = d.items[0];
  assert.equal(
    (await post(outsider, `/notifications/${item.id}/read`)).status,
    404,
  );
  assert.equal(
    (await post(learner, `/notifications/${item.id}/read`)).status,
    200,
  );
  assert.equal(
    (await post(learner, `/notifications/${item.id}/read`)).status,
    200,
  );
  assert.equal(
    (await learner.agent.get("/api/admin/learning-sessions")).status,
    403,
  );
  const inspection = (await admin.agent.get("/api/admin/learning-sessions"))
    .body;
  assert.ok(
    inspection.bookings.some(
      (b) => b.id === booking.id && b.learning_status === "completed",
    ),
  );
  assert.ok(inspection.attendance.length);
  assert.ok(
    (await admin.agent.get("/api/admin/audit")).body.items.some(
      (x) => x.action === "reschedule.accepted",
    ),
  );
});
