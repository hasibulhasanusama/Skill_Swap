import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { transaction } from "./db.js";
export async function migrateDatabase(
  db,
  { directory = new URL("../db/migrations/", import.meta.url) } = {},
) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const applied = [];
  for (const file of (await readdir(directory))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()) {
    const source = await readFile(new URL(file, directory), "utf8"),
      checksum = createHash("sha256").update(source).digest("hex");
    const changed = await transaction(db, async (c) => {
      // Serializes migration runners; compatible with standalone PostgreSQL and PGlite.
      await c.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      const row = (
        await c.query(
          "SELECT checksum FROM schema_migrations WHERE filename=$1",
          [file],
        )
      ).rows[0];
      if (row) {
        if (row.checksum !== checksum)
          throw new Error(
            `Migration ${file} changed after it was applied. Restore the original file and add a new migration.`,
          );
        return false;
      }
      if (c.exec) await c.exec(source);
      else await c.query(source);
      await c.query(
        "INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)",
        [file, checksum],
      );
      return true;
    });
    if (changed) applied.push(file);
  }
  return applied;
}
