import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, mkdtemp, copyFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { migrateDatabase } from "../server/migrations.js";
test("stage 2 database is adopted and upgraded without replacing existing users", async () => {
  const db = new PGlite();
  try {
    for (const f of ["001_core.sql", "002_exchange.sql"])
      await db.exec(
        await readFile(
          new URL("../db/migrations/" + f, import.meta.url),
          "utf8",
        ),
      );
    await db.query(
      "INSERT INTO users(email,password_hash,name,institution,verification) VALUES('existing@example.test','existing-password-hash','Existing Student','Existing Institution','approved')",
    );
    assert.deepEqual(await migrateDatabase(db), [
      "001_core.sql",
      "002_exchange.sql",
      "003_learning.sql",
      "004_payments.sql",
      "005_projects_reviews.sql",
      "006_admin_settings.sql",
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT password_hash FROM users WHERE email='existing@example.test'",
        )
      ).rows[0].password_hash,
      "existing-password-hash",
    );
    assert.deepEqual(await migrateDatabase(db), []);
  } finally {
    await db.close();
  }
});
test("failed migrations roll back schema and ledger; applied checksum edits are rejected", async () => {
  const db = new PGlite(),
    root = await mkdtemp(path.join(os.tmpdir(), "migration-"));
  const directory = pathToFileURL(root + path.sep);
  try {
    for (const f of [
      "001_core.sql",
      "002_exchange.sql",
      "003_learning.sql",
      "004_payments.sql",
      "005_projects_reviews.sql",
      "006_admin_settings.sql",
    ])
      await copyFile(
        new URL("../db/migrations/" + f, import.meta.url),
        path.join(root, f),
      );
    await migrateDatabase(db, { directory });
    await writeFile(
      path.join(root, "007_bad.sql"),
      "CREATE TABLE should_rollback(id INTEGER); SELECT nonexistent_column FROM users;",
    );
    await assert.rejects(
      migrateDatabase(db, { directory }),
      /nonexistent_column/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM information_schema.tables WHERE table_name='should_rollback'",
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM schema_migrations")).rows[0].count,
      6,
    );
    await rm(path.join(root, "007_bad.sql"));
    await writeFile(
      path.join(root, "003_learning.sql"),
      "-- edited applied migration",
    );
    await assert.rejects(
      migrateDatabase(db, { directory }),
      /changed after it was applied/,
    );
  } finally {
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});
