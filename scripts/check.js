import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
for (const dir of ["server", "scripts", "public", "tests"])
  for (const file of readdirSync(dir, { recursive: true }).filter((f) =>
    f.endsWith(".js"),
  )) {
    const r = spawnSync(process.execPath, ["--check", `${dir}/${file}`], {
      stdio: "inherit",
    });
    if (r.status) process.exit(r.status);
  }
const config = spawnSync(
  process.execPath,
  ["--check", "playwright.config.js"],
  { stdio: "inherit" },
);
if (config.status) process.exit(config.status);
console.log("JavaScript syntax checks passed.");
