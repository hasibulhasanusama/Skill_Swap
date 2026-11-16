import "dotenv/config";
import session from "express-session";
import pgSession from "connect-pg-simple";
import { pool } from "./db.js";
import { createApp } from "./app.js";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  throw new Error("Set SESSION_SECRET to at least 32 characters.");
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL before starting.");
if (process.env.NODE_ENV === "production") {
  if (process.env.SESSION_SECRET.startsWith("replace-"))
    throw new Error("Replace the example session secret.");
  if (!process.env.APP_ORIGIN?.startsWith("https://"))
    throw new Error("Production APP_ORIGIN requires HTTPS.");
  if (process.env.DEMO_ENABLED === "true")
    throw new Error("Disable DEMO_ENABLED for production.");
}
await pool.query("SELECT id FROM platform_policies WHERE id=1");
const store = new (pgSession(session))({ pool, tableName: "session" });
const app = createApp({ db: pool, store });
const server = app.listen(process.env.PORT || 3000, () =>
  console.log(
    `Skill Swap: ${process.env.APP_ORIGIN || "http://localhost:3000"}`,
  ),
);
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
