import "./test-environment.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { matchStudents } from "../server/matching.js";
import { seed } from "../scripts/seed.js";
let db, app, storage, a, b, outsider, admin, id, proposal;
const post = (actor, url, body) =>
  actor.agent
    .post("/api" + url)
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
const put = (actor, url, body) =>
  actor.agent
    .put("/api" + url)
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
async function login(email) {
  const agent = request.agent(app);
  const start = await agent.get("/api/auth/me");
  const r = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", start.body.csrf)
    .send({ email, password: "StudentDemo!2026" });
  assert.equal(r.status, 200);
  return { agent, csrf: r.body.csrf, user: r.body.user };
}
const mine = async (actor) =>
  (await actor.agent.get("/api/exchanges")).body.items;
before(async () => {
  process.env.DEMO_ENABLED = "true";
  db = new PGlite();
  for (const f of [
    "001_core.sql",
    "002_exchange.sql",
    "003_learning.sql",
    "004_payments.sql",
    "005_projects_reviews.sql",
    "006_admin_settings.sql",
  ])
    await db.exec(
      await readFile(new URL("../db/migrations/" + f, import.meta.url), "utf8"),
    );
  await seed(db);
  storage = await mkdtemp(path.join(os.tmpdir(), "exchange-"));
  app = createApp({
    db,
    storageDir: storage,
    secret: "test-exchange-secret-at-least-32-characters",
  });
  a = await login("student3@skillswap.test");
  b = await login("student4@skillswap.test");
  outsider = await login("student5@skillswap.test");
  admin = await login("admin@skillswap.test");
});
after(async () => {
  await db.close();
  await rm(storage, { recursive: true, force: true });
});
test("matching explains complementary skills, level compatibility and overlap", async () => {
  const r = await a.agent.get("/api/exchange/matches");
  assert.equal(r.status, 200);
  const match = r.body.items.find((m) => m.student.id === b.user.id);
  assert.ok(match);
  assert.deepEqual(match.give, ["python"]);
  assert.deepEqual(match.receive, ["illustration"]);
  assert.ok(match.explanations.some((x) => x.includes("Asia/Dhaka")));
  assert.ok(match.explanations.some((x) => x.includes("requested level")));
  const low = matchStudents(
    [
      { kind: "teach", skill: "python", level: 1 },
      { kind: "learn", skill: "art", level: 3 },
    ],
    [
      { kind: "learn", skill: "python", level: 2 },
      { kind: "teach", skill: "art", level: 2 },
    ],
    [{ weekday: 1, start_minute: 0, end_minute: 60 }],
    [{ weekday: 1, start_minute: 0, end_minute: 60 }],
  );
  assert.equal(low, null);
});
test("preferences normalize names and reject duplicate skills or overlapping times", async () => {
  const r = await put(outsider, "/exchange/preferences", {
    skills: [
      { skill: " Web   Design ", kind: "teach", level: 3 },
      { skill: "english", kind: "learn", level: 1 },
    ],
    availability: [{ weekday: 2, start_minute: 1000, end_minute: 1100 }],
  });
  assert.equal(r.status, 200);
  const p = await outsider.agent.get("/api/exchange/preferences");
  assert.ok(p.body.skills.some((s) => s.skill === "web design"));
  assert.equal(
    (
      await put(outsider, "/exchange/preferences", {
        skills: [
          { skill: "WEB design", kind: "teach", level: 1 },
          { skill: "web design", kind: "teach", level: 2 },
        ],
        availability: [],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await put(outsider, "/exchange/preferences", {
        skills: [],
        availability: [
          { weekday: 1, start_minute: 600, end_minute: 660 },
          { weekday: 1, start_minute: 630, end_minute: 690 },
        ],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await put(outsider, "/exchange/preferences", {
        skills: [],
        availability: [{ weekday: 1, start_minute: 650, end_minute: 600 }],
      })
    ).status,
    400,
  );
});
test("request checks compatibility, self requests and reciprocal active duplicates", async () => {
  assert.equal(
    (
      await post(a, "/exchanges", {
        recipient_id: a.user.id,
        requester_skill: "python",
        recipient_skill: "illustration",
        message: "Learn together.",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(a, "/exchanges", {
        recipient_id: b.user.id,
        requester_skill: "english",
        recipient_skill: "illustration",
        message: "Learn together.",
      })
    ).status,
    400,
  );
  const r = await post(a, "/exchanges", {
    recipient_id: b.user.id,
    requester_skill: "python",
    recipient_skill: "illustration",
    message: "Let us build a small creative coding project.",
  });
  assert.equal(r.status, 201);
  id = r.body.exchange.id;
  assert.equal(
    (
      await post(b, "/exchanges", {
        recipient_id: a.user.id,
        requester_skill: "illustration",
        recipient_skill: "python",
        message: "Reciprocal duplicate request.",
      })
    ).status,
    409,
  );
  assert.equal(
    (await post(outsider, `/exchanges/${id}/respond`, { action: "accept" }))
      .status,
    404,
  );
  assert.equal(
    (await post(a, `/exchanges/${id}/respond`, { action: "accept" })).status,
    409,
  );
  assert.equal(
    (await mine(outsider)).some((x) => x.id === id),
    false,
  );
  assert.equal(
    (await post(b, `/exchanges/${id}/respond`, { action: "accept" })).status,
    200,
  );
  assert.equal(
    (await post(b, `/exchanges/${id}/respond`, { action: "accept" })).status,
    409,
  );
});
test("agreement requires both teaching directions, valid future non-overlapping schedule", async () => {
  const first = new Date(Date.now() + 20 * 86400000);
  proposal = {
    revision: 0,
    requester_objective: "Create a practical digital illustration.",
    recipient_objective: "Write a Python script for a creative task.",
    sessions: [
      {
        teacher_id: a.user.id,
        starts_at: first.toISOString(),
        duration_minutes: 60,
      },
      {
        teacher_id: b.user.id,
        starts_at: new Date(first.getTime() + 86400000).toISOString(),
        duration_minutes: 60,
      },
    ],
  };
  assert.equal(
    (
      await put(a, `/exchanges/${id}/agreement`, {
        ...proposal,
        sessions: proposal.sessions.map((s) => ({
          ...s,
          teacher_id: a.user.id,
        })),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await put(a, `/exchanges/${id}/agreement`, {
        ...proposal,
        sessions: proposal.sessions.map((s) => ({
          ...s,
          starts_at: first.toISOString(),
        })),
      })
    ).status,
    400,
  );
  assert.equal(
    (await put(a, `/exchanges/${id}/agreement`, proposal)).status,
    200,
  );
  assert.equal(
    (await post(a, `/exchanges/${id}/accept-agreement`, { revision: 1 }))
      .status,
    200,
  );
  assert.equal((await mine(a)).find((x) => x.id === id).status, "negotiating");
  assert.equal(
    (await post(a, `/exchanges/${id}/accept-agreement`, { revision: 1 }))
      .status,
    409,
  );
});
test("editing clears prior acceptance and stale revisions cannot activate", async () => {
  assert.equal(
    (await put(b, `/exchanges/${id}/agreement`, { ...proposal, revision: 0 }))
      .status,
    409,
  );
  assert.equal(
    (
      await put(b, `/exchanges/${id}/agreement`, {
        ...proposal,
        revision: 1,
        recipient_objective: "Create and explain a small Python utility.",
      })
    ).status,
    200,
  );
  let x = (await mine(a)).find((x) => x.id === id);
  assert.equal(x.revision, 2);
  assert.equal(x.requester_accepted, false);
  assert.equal(x.recipient_accepted, false);
  assert.equal(
    (await post(a, `/exchanges/${id}/accept-agreement`, { revision: 1 }))
      .status,
    409,
  );
  assert.equal(
    (await post(a, `/exchanges/${id}/accept-agreement`, { revision: 2 }))
      .status,
    200,
  );
  assert.equal(
    (await post(b, `/exchanges/${id}/accept-agreement`, { revision: 2 }))
      .status,
    200,
  );
  x = (await mine(a)).find((x) => x.id === id);
  assert.equal(x.status, "active");
  assert.equal(
    (await put(a, `/exchanges/${id}/agreement`, { ...proposal, revision: 2 }))
      .status,
    409,
  );
  assert.equal(
    (await post(a, `/exchanges/${id}/respond`, { action: "cancel" })).status,
    409,
  );
});
test("active exchange sessions block conflicting paid reservations", async () => {
  const listing = (
    await db.query("SELECT * FROM listings WHERE mentor_id=$1 LIMIT 1", [
      outsider.user.id,
    ])
  ).rows[0];
  const slot = (
    await db.query(
      "INSERT INTO availability(listing_id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING id",
      [
        listing.id,
        proposal.sessions[0].starts_at,
        new Date(
          Date.parse(proposal.sessions[0].starts_at) + 3600000,
        ).toISOString(),
      ],
    )
  ).rows[0];
  assert.equal((await post(a, "/bookings", { slot_id: slot.id })).status, 409);
  const x = (await mine(a)).find((x) => x.id === id);
  assert.equal(
    (
      await post(
        a,
        `/exchanges/${id}/sessions/${x.sessions[0].id}/complete`,
        {},
      )
    ).status,
    409,
  );
});
test("completion is bilateral, reports are participant-only and resolutions are audited", async () => {
  assert.equal(
    (
      await post(outsider, `/exchanges/${id}/reports`, {
        reason: "I am not a participant in this agreement.",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post(a, `/exchanges/${id}/reports`, {
        reason: "My partner did not fulfil the agreed practice objectives.",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post(a, `/exchanges/${id}/reports`, {
        reason: "Duplicate unresolved report should be blocked.",
      })
    ).status,
    409,
  );
  assert.equal((await a.agent.get("/api/admin/exchanges")).status, 403);
  const inspection = await admin.agent.get("/api/admin/exchanges");
  const report = inspection.body.reports.find((r) => r.exchange_id === id);
  assert.ok(report);
  assert.equal(
    (
      await post(admin, `/admin/exchange-reports/${report.id}/resolve`, {
        reason: "Both participants agreed to complete the remaining practice.",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(admin, `/admin/exchange-reports/${report.id}/resolve`, {
        reason: "Second resolution is not allowed.",
      })
    ).status,
    409,
  );
  assert.ok(
    (await admin.agent.get("/api/admin/audit")).body.items.some(
      (x) => x.action === "exchange_report.resolved",
    ),
  );
  // Simulate elapsed time in the isolated database; the public API cannot edit active schedules.
  await db.query(
    "UPDATE exchange_sessions SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE exchange_id=$1",
    [id],
  );
  let x = (await mine(a)).find((x) => x.id === id);
  for (const s of x.sessions) {
    const teacher = s.teacher_id === a.user.id ? a : b,
      learner = teacher === a ? b : a;
    assert.equal(
      (await post(learner, `/exchanges/${id}/sessions/${s.id}/complete`, {}))
        .status,
      409,
    );
    assert.equal(
      (await post(teacher, `/exchanges/${id}/sessions/${s.id}/complete`, {}))
        .status,
      200,
    );
    assert.equal(
      (await post(teacher, `/exchanges/${id}/sessions/${s.id}/complete`, {}))
        .status,
      409,
    );
    assert.equal(
      (await post(learner, `/exchanges/${id}/sessions/${s.id}/complete`, {}))
        .status,
      200,
    );
  }
  x = (await mine(a)).find((x) => x.id === id);
  assert.equal(x.status, "completed");
  assert.ok(
    x.sessions.every((s) => s.teacher_completed && s.learner_confirmed),
  );
  assert.equal(
    (
      await post(
        a,
        `/exchanges/${id}/sessions/${x.sessions[0].id}/complete`,
        {},
      )
    ).status,
    409,
  );
});
test("unverified students cannot match and rejected/cancelled requests remain in history", async () => {
  const unverified = await login("student8@skillswap.test");
  assert.equal(
    (await unverified.agent.get("/api/exchange/matches")).status,
    403,
  );
  assert.equal(
    (
      await post(unverified, "/exchanges", {
        recipient_id: a.user.id,
        requester_skill: "test",
        recipient_skill: "python",
        message: "Not verified.",
      })
    ).status,
    403,
  );
  const r = await post(a, "/exchanges", {
    recipient_id: b.user.id,
    requester_skill: "python",
    recipient_skill: "illustration",
    message: "Another exchange after completion.",
  });
  assert.equal(r.status, 201);
  const newId = r.body.exchange.id;
  assert.equal(
    (await post(b, `/exchanges/${newId}/respond`, { action: "reject" })).status,
    200,
  );
  assert.equal((await mine(a)).find((x) => x.id === newId).status, "rejected");
  assert.equal(
    (await post(a, `/exchanges/${newId}/respond`, { action: "cancel" })).status,
    409,
  );
  const second = await post(a, "/exchanges", {
    recipient_id: b.user.id,
    requester_skill: "python",
    recipient_skill: "illustration",
    message: "This request will be cancelled.",
  });
  assert.equal(second.status, 201);
  assert.equal(
    (
      await post(a, `/exchanges/${second.body.exchange.id}/respond`, {
        action: "cancel",
      })
    ).status,
    200,
  );
});
test("activation rechecks conflicts after the first acceptance and verifies both accounts", async () => {
  const requestResult = await post(a, "/exchanges", {
    recipient_id: b.user.id,
    requester_skill: "python",
    recipient_skill: "illustration",
    message: "Check schedule again at activation.",
  });
  assert.equal(requestResult.status, 201);
  const exchangeId = requestResult.body.exchange.id;
  assert.equal(
    (await post(b, `/exchanges/${exchangeId}/respond`, { action: "accept" }))
      .status,
    200,
  );
  assert.equal(
    (await put(a, `/exchanges/${exchangeId}/agreement`, proposal)).status,
    200,
  );
  assert.equal(
    (
      await post(a, `/exchanges/${exchangeId}/accept-agreement`, {
        revision: 1,
      })
    ).status,
    200,
  );
  await db.query("UPDATE users SET verification='unverified' WHERE id=$1", [
    a.user.id,
  ]);
  assert.equal(
    (
      await post(b, `/exchanges/${exchangeId}/accept-agreement`, {
        revision: 1,
      })
    ).status,
    409,
  );
  await db.query("UPDATE users SET verification='approved' WHERE id=$1", [
    a.user.id,
  ]);
  const l = (
    await db.query("SELECT * FROM listings WHERE mentor_id=$1 LIMIT 1", [
      outsider.user.id,
    ])
  ).rows[0];
  const begins = new Date(
      Date.parse(proposal.sessions[0].starts_at) + 60000,
    ).toISOString(),
    ends = new Date(Date.parse(begins) + 900000).toISOString();
  const slot = (
    await db.query(
      "INSERT INTO availability(listing_id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING id",
      [l.id, begins, ends],
    )
  ).rows[0];
  await db.query(
    "INSERT INTO bookings(learner_id,mentor_id,listing_id,slot_id,starts_at,ends_at,amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [a.user.id, outsider.user.id, l.id, slot.id, begins, ends, l.fee_minor],
  );
  assert.equal(
    (
      await post(b, `/exchanges/${exchangeId}/accept-agreement`, {
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (await mine(a)).find((x) => x.id === exchangeId).status,
    "negotiating",
  );
  assert.equal(
    (await mine(a)).find((x) => x.id === exchangeId).recipient_accepted,
    false,
  );
});
test("migrations and seed are repeatable without duplicate demo agreements", async () => {
  const before = Number(
    (
      await db.query(
        "SELECT count(*) FROM exchanges WHERE requester_id=1 AND recipient_id=2",
      )
    ).rows[0].count,
  );
  for (const f of [
    "001_core.sql",
    "002_exchange.sql",
    "003_learning.sql",
    "004_payments.sql",
    "005_projects_reviews.sql",
    "006_admin_settings.sql",
  ])
    await db.exec(
      await readFile(new URL("../db/migrations/" + f, import.meta.url), "utf8"),
    );
  await seed(db);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM exchanges WHERE requester_id=1 AND recipient_id=2",
        )
      ).rows[0].count,
    ),
    before,
  );
});
