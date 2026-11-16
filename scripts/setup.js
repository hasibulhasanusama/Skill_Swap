import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
// Exclusive creation deliberately preserves every existing configuration.
const template = await readFile(
  new URL("../.env.example", import.meta.url),
  "utf8",
);
const value = template
  .replace(
    /^SESSION_SECRET=.*$/m,
    `SESSION_SECRET=${randomBytes(48).toString("hex")}`,
  )
  .replace(
    /^SANDBOX_WEBHOOK_SECRET=.*$/m,
    `SANDBOX_WEBHOOK_SECRET=${randomBytes(48).toString("hex")}`,
  );
try {
  await writeFile(new URL("../.env", import.meta.url), value, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Created .env with independent random secrets. Configure DATABASE_URL before migrating.",
  );
} catch (e) {
  if (e.code !== "EEXIST") throw e;
  console.log("Existing .env preserved.");
}
