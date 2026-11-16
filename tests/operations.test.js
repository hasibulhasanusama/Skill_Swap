import "./test-environment.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { migrateDatabase } from "../server/migrations.js";
import { createApp } from "../server/app.js";
import { bootstrapAdministrator } from "../server/bootstrap.js";
import { verifyPassword } from "../server/security.js";
test("health readiness fails closed before migrations and bootstrap creates only the first separate administrator", async () => {
  const db = new PGlite();
  try {
    const app = createApp({
      db,
      secret: "operations-test-secret-32-characters-long",
    });
    assert.equal((await request(app).get("/health/live")).status, 200);
    let r = await request(app).get("/health/ready");
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { status: "unavailable" });
    assert.equal(r.headers["set-cookie"], undefined);
    await migrateDatabase(db);
    assert.equal((await request(app).get("/health/ready")).status, 200);
    await assert.rejects(
      bootstrapAdministrator(db, {
        email: "admin@example.test",
        name: "Root Admin",
        password: "short",
      }),
      /16 and 128/,
    );
    const password = "IndependentBootstrapPassword!2026";
    const id = await bootstrapAdministrator(db, {
      email: "Admin@Example.test",
      name: "Root Admin",
      password,
    });
    const u = (await db.query("SELECT * FROM users WHERE id=$1", [id])).rows[0];
    assert.equal(u.role, "admin");
    assert.equal(u.admin_role, "superadmin");
    assert.equal(u.email, "admin@example.test");
    assert.ok(await verifyPassword(password, u.password_hash));
    await assert.rejects(
      bootstrapAdministrator(db, {
        email: "second@example.test",
        name: "Second Admin",
        password,
      }),
      /already exists/,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
