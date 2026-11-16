import { transaction } from "./db.js";
import { hashPassword } from "./security.js";
export async function bootstrapAdministrator(db, { email, name, password }) {
  if (
    typeof email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    email.length > 254
  )
    throw new Error("A valid bootstrap email is required.");
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100)
    throw new Error(
      "A bootstrap name between 2 and 100 characters is required.",
    );
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    password.length > 128
  )
    throw new Error(
      "A bootstrap password between 16 and 128 characters is required.",
    );
  const hash = await hashPassword(password);
  return transaction(db, async (c) => {
    await c.query("LOCK TABLE users IN EXCLUSIVE MODE");
    if (
      (await c.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows
        .length
    )
      throw new Error(
        "An administrator already exists. Use the existing role management screen.",
      );
    const result = await c.query(
      "INSERT INTO users(email,password_hash,name,institution,role,verification,admin_role) VALUES($1,$2,$3,'Platform administration','admin','approved','superadmin') RETURNING id",
      [email.trim().toLowerCase(), hash, name.trim()],
    );
    return result.rows[0].id;
  });
}
