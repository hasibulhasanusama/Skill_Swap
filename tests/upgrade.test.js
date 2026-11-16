import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { copyPrevious } from "../scripts/upgrade.js";
const roots = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "upgrade-"));
  roots.push(root);
  const old = path.join(root, "old"),
    current = path.join(root, "new");
  await mkdir(path.join(old, "storage/private"), { recursive: true });
  await mkdir(current);
  await writeFile(path.join(old, "package.json"), ' {"name":"skill-swap"}');
  await writeFile(
    path.join(old, ".env"),
    "DATABASE_URL=postgres://example\nSESSION_SECRET=test-value\nSTORAGE_DIR=./storage/private\n",
  );
  await writeFile(
    path.join(old, "storage/private/example"),
    "private document",
  );
  return { old, current };
}
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});
test("cumulative upgrade preserves configuration and uploads and is repeatable", async () => {
  const { old, current } = await fixture();
  assert.equal((await copyPrevious(old, current)).copied, 2);
  assert.equal(
    await readFile(path.join(current, "storage/private/example"), "utf8"),
    "private document",
  );
  assert.equal(
    await readFile(path.join(current, ".env"), "utf8"),
    await readFile(path.join(old, ".env"), "utf8"),
  );
  assert.equal((await copyPrevious(old, current)).copied, 0);
});
test("upgrade detects configuration conflicts before copying files", async () => {
  const { old, current } = await fixture();
  await writeFile(
    path.join(current, ".env"),
    "A different existing configuration",
  );
  await assert.rejects(copyPrevious(old, current), /conflicts/);
  await assert.rejects(access(path.join(current, "storage/private/example")));
  assert.equal(
    await readFile(path.join(current, ".env"), "utf8"),
    "A different existing configuration",
  );
});
test("upgrade refuses same-folder and unsafe parent-relative storage copying", async () => {
  const { old, current } = await fixture();
  await assert.rejects(copyPrevious(old, old), /different folder/);
  await writeFile(path.join(old, ".env"), "STORAGE_DIR=../shared-private\n");
  await assert.rejects(copyPrevious(old, current), /manual absolute-path/);
});
