import {
  readFile,
  readdir,
  lstat,
  mkdir,
  copyFile,
  access,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
async function filesUnder(root) {
  const items = [];
  if (!(await exists(root))) return items;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(
        "Symlinked storage is not copied automatically. Set STORAGE_DIR to its existing absolute location.",
      );
    if (entry.isDirectory())
      for (const child of await filesUnder(target))
        items.push(path.join(entry.name, child));
    else if (entry.isFile()) items.push(entry.name);
  }
  return items;
}
// No database reset, source overwrite or secret output. Plan all copies before writing.
export async function copyPrevious(previous, current) {
  previous = path.resolve(previous);
  current = path.resolve(current);
  if (previous === current)
    throw new Error("Extract the new release into a different folder.");
  const priorPackage = JSON.parse(
    await readFile(path.join(previous, "package.json"), "utf8"),
  );
  if (priorPackage.name !== "skill-swap")
    throw new Error(
      "The source folder must be the existing skill-swap project.",
    );
  const priorEnv = path.join(previous, ".env");
  if (!(await exists(priorEnv)))
    throw new Error("The old project has no .env. Follow fresh setup instead.");
  const env = await readFile(priorEnv, "utf8");
  const setting = env.match(/^\s*STORAGE_DIR\s*=\s*(.*?)\s*$/m);
  const raw = setting
    ? setting[1].replace(/^(['"])(.*)\1$/, "$2")
    : "./storage/private";
  if (!raw || raw.includes("${") || raw.includes("#"))
    throw new Error(
      "Use an explicit STORAGE_DIR without variable expansion or inline comments before upgrading.",
    );
  // Absolute storage paths stay shared. Relative storage directories are copied to the same relative path.
  if (!path.isAbsolute(raw) && raw.split(/[\\/]/).includes(".."))
    throw new Error(
      "Parent-relative STORAGE_DIR needs a manual absolute-path configuration before upgrading.",
    );
  const oldStorage = path.resolve(previous, raw),
    newStorage = path.resolve(current, raw);
  const plan = [{ source: priorEnv, target: path.join(current, ".env") }];
  if (oldStorage !== newStorage)
    for (const name of await filesUnder(oldStorage))
      if (name !== ".gitkeep")
        plan.push({
          source: path.join(oldStorage, name),
          target: path.join(newStorage, name),
        });
  const digest = (b) => createHash("sha256").update(b).digest("hex");
  const copies = [];
  for (const item of plan) {
    if ((await lstat(item.source)).isSymbolicLink())
      throw new Error("Refusing a symlinked source file.");
    if (await exists(item.target)) {
      if (
        (await lstat(item.target)).isSymbolicLink() ||
        digest(await readFile(item.source)) !==
          digest(await readFile(item.target))
      )
        throw new Error(
          "A destination configuration or upload conflicts. No files were copied. Use a fresh extracted release folder.",
        );
    } else copies.push(item);
  }
  for (const item of copies) {
    await mkdir(path.dirname(item.target), { recursive: true });
    await copyFile(item.source, item.target, constants.COPYFILE_EXCL);
  }
  return { copied: copies.length, absoluteStorage: oldStorage === newStorage };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const i = process.argv.indexOf("--from");
  if (i < 0 || !process.argv[i + 1]) {
    console.error(
      'Usage: node scripts/upgrade.js --from "C:\\path\\to\\old\\skill-swap"',
    );
    process.exitCode = 1;
  } else
    try {
      const result = await copyPrevious(
        process.argv[i + 1],
        path.resolve(fileURLToPath(new URL("..", import.meta.url))),
      );
      console.log(
        `Upgrade files ready (${result.copied} files copied; existing configuration preserved).`,
      );
      console.log(
        "Next: npm ci, npm run db:migrate, then npm start. Do not reset the database.",
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
