import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, transaction } from "../server/db.js";
import { hashPassword } from "../server/security.js";
export async function seedAdministration(db) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_ENABLED !== "true"
  )
    throw new Error(
      "Administrator demo seed requires enabled non-production demo mode.",
    );
  const hash = await hashPassword("StudentDemo!2026");
  await transaction(db, async (c) => {
    const root = (
      await c.query(
        "SELECT id FROM users WHERE email='admin@skillswap.test' AND role='admin'",
      )
    ).rows[0];
    if (!root) throw new Error("Run the main demo seed first.");
    for (const role of ["verifier", "support", "moderator", "finance"]) {
      const email = role + "@skillswap.test";
      const old = (
        await c.query("SELECT role FROM users WHERE email=$1", [email])
      ).rows[0];
      if (old && old.role !== "admin")
        throw new Error(
          "A reserved demo staff email belongs to a student; no role was changed.",
        );
      await c.query(
        "INSERT INTO users(email,password_hash,name,institution,role,admin_role) VALUES($1,$2,$3,'Platform administration','admin',$4) ON CONFLICT DO NOTHING",
        [email, hash, "Fictional " + role + " administrator", role],
      );
    }
    const title = "Fictional demo platform update";
    if (
      !(
        await c.query(
          "SELECT id FROM announcements WHERE title=$1 AND created_by=$2",
          [title, root.id],
        )
      ).rows.length
    )
      await c.query(
        "INSERT INTO announcements(title,body,audience,published,created_by) VALUES($1,'Fictional demonstration: student projects, sandbox protection and in-app support are available. No real payments or institutional endorsement are involved.','public',true,$2)",
        [title, root.id],
      );
    const student = (
        await c.query(
          "SELECT id FROM users WHERE email='student8@skillswap.test'",
        )
      ).rows[0],
      support = (
        await c.query(
          "SELECT id FROM users WHERE email='support@skillswap.test' AND role='admin'",
        )
      ).rows[0];
    if (student && support) {
      const subject = "Fictional student verification support";
      if (
        !(
          await c.query(
            "SELECT id FROM support_tickets WHERE user_id=$1 AND subject=$2",
            [student.id, subject],
          )
        ).rows.length
      ) {
        const t = (
          await c.query(
            "INSERT INTO support_tickets(user_id,subject,body,status,assigned_to) VALUES($1,$2,'Fictional demo request: please explain how to submit a current student ID privately.','in_progress',$3) RETURNING id",
            [student.id, subject, support.id],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO support_replies(ticket_id,author_id,body) VALUES($1,$2,'Fictional support reply: use Profile & verification to upload your enrolment document. It will not be public.')",
          [t.id, support.id],
        );
      }
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await seedAdministration(pool);
    console.log(
      "Fictional restricted administrators, announcement and support request seeded.",
    );
  } finally {
    await pool.end();
  }
}
