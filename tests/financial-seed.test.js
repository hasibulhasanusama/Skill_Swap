import "./test-environment.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase } from "../server/migrations.js";
import { seed } from "../scripts/seed.js";
import { seedPayments } from "../scripts/seed-payments.js";
test("financial demo seed is repeatable, fictional and includes held and released scenarios", async () => {
  const db = new PGlite();
  process.env.DEMO_ENABLED = "true";
  try {
    await migrateDatabase(db);
    await seed(db);
    await seedPayments(db);
    const before = Number(
      (await db.query("SELECT count(*) FROM payments")).rows[0].count,
    );
    await seedPayments(db);
    assert.equal(
      Number((await db.query("SELECT count(*) FROM payments")).rows[0].count),
      before,
    );
    assert.equal(before, 3);
    assert.equal(
      (await db.query("SELECT count(*) FROM payments WHERE status='failed'"))
        .rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM payment_allocations WHERE status='released'",
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM payment_disputes WHERE status='open'",
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM withdrawals WHERE status='pending'",
        )
      ).rows[0].count,
      1,
    );
    for (const row of (
      await db.query(
        "SELECT a.balance_minor,COALESCE(sum(e.delta_minor),0) total FROM mentor_accounts a LEFT JOIN wallet_entries e ON e.user_id=a.user_id GROUP BY a.user_id,a.balance_minor",
      )
    ).rows)
      assert.equal(row.balance_minor, Number(row.total));
  } finally {
    await db.close();
  }
});
