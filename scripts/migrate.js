import { pool } from "../server/db.js";
import { migrateDatabase } from "../server/migrations.js";
try {
  const files = await migrateDatabase(pool);
  console.log(
    files.length
      ? "Applied: " + files.join(", ")
      : "Database is already up to date.",
  );
} finally {
  await pool.end();
}
