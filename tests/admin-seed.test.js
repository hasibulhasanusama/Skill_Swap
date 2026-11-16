import "./test-environment.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase } from "../server/migrations.js";
import { seed } from "../scripts/seed.js";
import { seedAdministration } from "../scripts/seed-administration.js";
import { verifyPassword } from "../server/security.js";
test("restricted administrator demo seed is repeatable and never promotes student accounts", async () => {
  const db = new PGlite();
  try {
    await migrateDatabase(db);
    await seed(db);
    await seedAdministration(db);
    await seedAdministration(db);
    assert.equal(
      (await db.query("SELECT count(*) FROM users WHERE role='student'"))
        .rows[0].count,
      8,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM users WHERE role='admin'")).rows[0]
        .count,
      5,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM announcements")).rows[0].count,
      1,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM support_tickets")).rows[0].count,
      1,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM support_replies")).rows[0].count,
      1,
    );
    const verifier = (
      await db.query(
        "SELECT * FROM users WHERE email='verifier@skillswap.test'",
      )
    ).rows[0];
    assert.equal(verifier.admin_role, "verifier");
    assert.equal(
      await verifyPassword("StudentDemo!2026", verifier.password_hash),
      true,
    );
    assert.equal(verifier.verification, "unverified");
  } finally {
    await db.close();
  }
});
