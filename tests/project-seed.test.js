import "./test-environment.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateDatabase } from "../server/migrations.js";
import { seed } from "../scripts/seed.js";
import { seedProjects } from "../scripts/seed-projects.js";
import { createLocalStorage } from "../server/storage.js";
import { publicPortfolio, publicReviews } from "../server/projects.js";
test("project demo seeds version history, private attachment, public text and an eligible fictional review once", async () => {
  const db = new PGlite(),
    root = await mkdtemp(path.join(os.tmpdir(), "project-seed-"));
  try {
    await migrateDatabase(db);
    await seed(db);
    const storage = createLocalStorage(root);
    await seedProjects(db, { storage });
    await seedProjects(db, { storage });
    assert.equal(
      (await db.query("SELECT count(*) FROM project_tasks")).rows[0].count,
      1,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM project_submissions")).rows[0]
        .count,
      2,
    );
    assert.equal(
      (await db.query("SELECT count(*) FROM project_feedback")).rows[0].count,
      2,
    );
    const p = (await db.query("SELECT * FROM portfolio_entries")).rows[0];
    assert.equal(p.visibility, "public");
    assert.equal(p.share_file, false);
    const published = await publicPortfolio(db, p.owner_id);
    assert.equal(published.length, 1);
    assert.equal(published[0].has_attachment, false);
    const t = (await db.query("SELECT * FROM project_tasks")).rows[0];
    assert.equal((await publicReviews(db, t.mentor_id)).length, 1);
    const file = (
      await db.query("SELECT * FROM files WHERE id=$1", [p.file_id])
    ).rows[0];
    assert.equal(
      (await storage.read(file.storage_key)).length,
      file.size_bytes,
    );
    assert.ok(
      (await storage.read(file.storage_key)).toString().includes("Fictional"),
    );
  } finally {
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});
