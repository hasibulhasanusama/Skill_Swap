import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(derive);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + (await scrypt(password, salt, 64)).toString("hex");
}
export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(":");
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
export const publicUser = (u) =>
  u && {
    id: u.id,
    name: u.name,
    email: u.email,
    institution: u.institution,
    bio: u.bio,
    student_id: u.student_id || "",
    age: u.age ?? null,
    gender: u.gender || "",
    phone: u.phone || "",
    has_avatar: Boolean(u.avatar_key),
    avatar_updated_at: u.avatar_updated_at || null,
    role: u.role,
    verification: u.verification,
    profile_public: u.profile_public,
    admin_role: u.admin_role,
    permissions: u.admin_permissions || [],
  };
