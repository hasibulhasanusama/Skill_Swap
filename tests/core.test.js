import "./test-environment.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { seed } from "../scripts/seed.js";
let db, app, storage, student, admin, other, csrf, adminCsrf, otherCsrf;
async function signin(email) {
  const agent = request.agent(app);
  const start = await agent.get("/api/auth/me");
  const r = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", start.body.csrf)
    .send({ email, password: "StudentDemo!2026" });
  assert.equal(r.status, 200);
  return [agent, r.body.csrf];
}
before(async () => {
  process.env.DEMO_ENABLED = "true";
  db = new PGlite();
  await db.exec(
    await readFile(
      new URL("../db/migrations/001_core.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../db/migrations/002_exchange.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../db/migrations/003_learning.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../db/migrations/004_payments.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../db/migrations/005_projects_reviews.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../db/migrations/006_admin_settings.sql", import.meta.url),
      "utf8",
    ),
  );
  await seed(db);
  storage = await mkdtemp(path.join(os.tmpdir(), "skillswap-"));
  app = createApp({
    db,
    storageDir: storage,
    secret: "test-only-secret-at-least-32-characters-long",
  });
  [student, csrf] = await signin("student1@skillswap.test");
  [admin, adminCsrf] = await signin("admin@skillswap.test");
  [other, otherCsrf] = await signin("student8@skillswap.test");
});
after(async () => {
  await db.close();
  await rm(storage, { recursive: true, force: true });
});
test("public marketplace has 12 database listings and filters", async () => {
  const r = await request(app).get("/api/listings");
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 12);
  assert.equal(r.body.items.length, 9);
  const filtered = await request(app).get("/api/listings?q=Python");
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.total, 1);
  assert.equal(
    (await request(app).get("/api/listings?max_price=0")).body.total,
    0,
  );
});
test("CSRF and admin boundaries are enforced", async () => {
  assert.equal((await student.post("/api/auth/logout")).status, 403);
  assert.equal((await student.get("/api/admin/overview")).status, 403);
  assert.equal((await request(app).get("/api/dashboard")).status, 401);
});
test("unverified student cannot publish", async () => {
  const r = await other
    .post("/api/listings")
    .set("X-CSRF-Token", otherCsrf)
    .send({});
  assert.equal(r.status, 403);
});
test("private upload -> admin approval -> audit, with resubmission conflict", async () => {
  const r = await other
    .post("/api/verification")
    .set("X-CSRF-Token", otherCsrf)
    .attach("document", Buffer.from("%PDF-1.4\nfictional test document"), {
      filename: "student.pdf",
      contentType: "application/pdf",
    });
  assert.equal(r.status, 201);
  const queue = await admin.get("/api/admin/verifications");
  const item = queue.body.items[0];
  assert.equal((await student.get("/api/files/" + item.file_id)).status, 404);
  assert.equal(
    (await request(app).get("/api/files/" + item.file_id)).status,
    401,
  );
  assert.equal((await admin.get("/api/files/" + item.file_id)).status, 200);
  assert.equal((await other.get("/api/files/" + item.file_id)).status, 200);
  const result = await admin
    .post("/api/admin/verifications/" + item.id)
    .set("X-CSRF-Token", adminCsrf)
    .send({
      status: "approved",
      reason: "Fictional enrolment document reviewed.",
    });
  assert.equal(result.status, 200);
  assert.equal(
    (await other.get("/api/auth/me")).body.user.verification,
    "approved",
  );
  assert.equal(
    (
      await admin
        .post("/api/admin/verifications/" + item.id)
        .set("X-CSRF-Token", adminCsrf)
        .send({ status: "rejected", reason: "Cannot review twice." })
    ).status,
    409,
  );
  assert.equal((await admin.get("/api/admin/audit")).body.items.length, 1);
});
test("unsafe uploads are rejected", async () => {
  assert.equal(
    (
      await student
        .post("/api/verification")
        .set("X-CSRF-Token", csrf)
        .attach("document", Buffer.from("<script>bad</script>"), "id.pdf")
    ).status,
    409,
  );
  const fresh = await signin("student7@skillswap.test");
  await db.query(
    "UPDATE users SET verification='unverified' WHERE email='student7@skillswap.test'",
  );
  assert.equal(
    (
      await fresh[0]
        .post("/api/verification")
        .set("X-CSRF-Token", fresh[1])
        .attach("document", Buffer.from("<script>bad</script>"), "id.pdf")
    ).status,
    400,
  );
});
test("listing ownership and database price are enforced; conflicts rejected", async () => {
  const { items } = (await request(app).get("/api/listings")).body;
  const own = items.find((l) => l.mentor_id === 1);
  assert.ok(own);
  const body = {
    category_id: own.category_id,
    title: "Unauthorized edit",
    description: "This should never be saved",
    level: "Beginner",
    objectives: "Test ownership protection",
    duration_minutes: 60,
    fee_minor: 1,
    status: "published",
  };
  assert.equal(
    (
      await other
        .put("/api/listings/" + own.id)
        .set("X-CSRF-Token", otherCsrf)
        .send(body)
    ).status,
    404,
  );
  const details = await request(app).get("/api/listings/" + own.id);
  const slot = details.body.slots[0];
  assert.equal(
    (
      await student
        .post("/api/bookings")
        .set("X-CSRF-Token", csrf)
        .send({ slot_id: slot.id })
    ).status,
    400,
  );
  const booked = await other
    .post("/api/bookings")
    .set("X-CSRF-Token", otherCsrf)
    .send({ slot_id: slot.id, amount_minor: 1 });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.booking.amount_minor, own.fee_minor);
  assert.equal(
    (
      await other
        .post("/api/bookings")
        .set("X-CSRF-Token", otherCsrf)
        .send({ slot_id: slot.id })
    ).status,
    409,
  );
  const dashboard = await other.get("/api/dashboard");
  assert.equal(dashboard.body.bookings.length, 1);
  assert.equal((await admin.get("/api/admin/overview")).body.bookings, 1);
});
test("password reset is expiring and single-use and registration does not sign in", async () => {
  const a = request.agent(app);
  let r = await a.get("/api/auth/me");
  const token = r.body.csrf;
  r = await a
    .post("/api/auth/register")
    .set("X-CSRF-Token", token)
    .send({
      name: "Test Student",
      institution: "Fictional College",
      email: "new@skillswap.test",
      password: "SecureTesting!2026",
      enrolled: true,
    });
  assert.equal(r.status, 201);
  assert.equal((await a.get("/api/auth/me")).body.user, null);
  assert.equal(
    (
      await a
        .post("/api/auth/recover")
        .set("X-CSRF-Token", token)
        .send({ email: "new@skillswap.test" })
    ).status,
    200,
  );
  const { readdir } = await import("node:fs/promises");
  const mail = JSON.parse(
    await readFile(
      path.join(
        storage,
        (await readdir(storage)).find((f) => f.startsWith("outbox-")),
      ),
      "utf8",
    ),
  );
  const resetToken = mail.reset_url.split("token=")[1];
  r = await a
    .post("/api/auth/reset")
    .set("X-CSRF-Token", token)
    .send({ token: resetToken, password: "NewSecureTesting!2026" });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await a
        .post("/api/auth/reset")
        .set("X-CSRF-Token", token)
        .send({ token: resetToken, password: "AnotherSecure!2026" })
    ).status,
    400,
  );
});
