// Isolated, disposable browser-test installation. Never connects to DATABASE_URL.
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateDatabase } from "../server/migrations.js";
import { seed } from "./seed.js";
import { createApp } from "../server/app.js";
if (process.env.QA_DEMO !== "true" || process.env.NODE_ENV === "production")
  throw new Error("Requires QA_DEMO=true in a non-production environment.");
Object.assign(process.env, {
  NODE_ENV: "test",
  DEMO_ENABLED: "true",
  SEED_FINANCE_DEMO: "true",
  SEED_PROJECT_DEMO: "true",
  SEED_ADMIN_DEMO: "true",
  SANDBOX_ENABLED: "true",
});
const storage = await mkdtemp(path.join(os.tmpdir(), "skillswap-browser-"));
process.env.STORAGE_DIR = storage;
const db = new PGlite();
await migrateDatabase(db);
await seed(db);
const portIndex = process.argv.indexOf("--port");
const port = Number(
  portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 3000,
);
const server = createApp({
  db,
  storageDir: storage,
  secret: "isolated-browser-fixture-secret-32-characters",
}).listen(port, "0.0.0.0", () =>
  console.log(`Disposable browser fixture listening on ${port}`),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await db.close();
    await rm(storage, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
