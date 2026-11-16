import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
// Storage adapter contract: put(Buffer)->key, read(key)->Buffer, delete(key)->void.
// An object-store adapter can implement this interface without changing API permissions.
export function createLocalStorage(directory) {
  const root = path.resolve(directory);
  const resolve = (key) => {
    if (!/^[0-9a-f-]{36}$/i.test(key)) throw new Error("Invalid storage key");
    return path.join(root, key);
  };
  return {
    async put(bytes) {
      await mkdir(root, { recursive: true });
      const key = randomUUID();
      await writeFile(resolve(key), bytes, { mode: 0o600, flag: "wx" });
      return key;
    },
    async read(key) {
      return readFile(resolve(key));
    },
    async delete(key) {
      await unlink(resolve(key)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    },
  };
}
export function documentType(bytes) {
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}
export const safeFilename = (name) =>
  path
    .basename(name.replace(/\\/g, "/"))
    .replace(/[\r\n\x00-\x1f]/g, "")
    .slice(0, 180) || "download";
