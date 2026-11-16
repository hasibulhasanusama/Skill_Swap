import { pool } from "../server/db.js";
import { bootstrapAdministrator } from "../server/bootstrap.js";
try {
  await bootstrapAdministrator(pool, {
    email: process.env.BOOTSTRAP_EMAIL,
    name: process.env.BOOTSTRAP_NAME,
    password: process.env.BOOTSTRAP_PASSWORD,
  });
  console.log(
    "Initial administrator created. Remove BOOTSTRAP_* variables now.",
  );
} finally {
  await pool.end();
}
