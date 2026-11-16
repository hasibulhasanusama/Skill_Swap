import { seedAdministration } from "./seed-administration.js";
import { seedProjects } from "./seed-projects.js";
import { createLocalStorage } from "../server/storage.js";
import { seedPayments } from "./seed-payments.js";
import { seedLearning } from "./seed-learning.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedExchange } from "./seed-exchange.js";
import { pool } from "../server/db.js";
import { hashPassword } from "../server/security.js";
export async function seed(db) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_ENABLED !== "true"
  )
    throw new Error(
      "Seed requires DEMO_ENABLED=true and non-production environment.",
    );
  const hash = await hashPassword("StudentDemo!2026");
  for (const name of [
    "Development",
    "Design",
    "Languages",
    "Academic",
    "Creative",
  ])
    await db.query(
      "INSERT INTO categories(name) VALUES($1) ON CONFLICT DO NOTHING",
      [name],
    );
  const names = [
    "Ariana Rahman",
    "Nabil Ahmed",
    "Maya Karim",
    "Rafi Islam",
    "Sara Hasan",
    "Tanvir Alam",
    "Ishita Sen",
    "Fahim Noor",
  ];
  for (let i = 0; i < 9; i++) {
    const admin = i === 8;
    await db.query(
      "INSERT INTO users(email,password_hash,name,institution,role,verification,bio,admin_role) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
      [
        admin ? "admin@skillswap.test" : `student${i + 1}@skillswap.test`,
        hash,
        admin ? "Demo Administrator" : names[i],
        "Fictional Riverdale University",
        admin ? "admin" : "student",
        i === 7 ? "unverified" : "approved",
        "Fictional demonstration account. Learning through practical, student-led projects.",
        admin ? "superadmin" : null,
      ],
    );
  }
  const categories = (await db.query("SELECT * FROM categories ORDER BY id"))
    .rows;
  const students = (
    await db.query("SELECT * FROM users WHERE role='student' ORDER BY id")
  ).rows;
  const titles = [
    "Build your first responsive website",
    "Design clear interfaces in Figma",
    "Speak English with confidence",
    "Understand calculus fundamentals",
    "Edit a short documentary",
    "Python for everyday automation",
    "Present your ideas clearly",
    "Create a visual brand identity",
    "Master spreadsheet essentials",
    "Start with digital illustration",
    "Learn SQL through real questions",
    "Write a compelling project story",
  ];
  for (let i = 0; i < titles.length; i++) {
    const mentor = students[i % 7];
    if (
      (
        await db.query(
          "SELECT id FROM listings WHERE title=$1 AND mentor_id=$2",
          [titles[i], mentor.id],
        )
      ).rows.length
    )
      continue;
    const l = (
      await db.query(
        "INSERT INTO listings(mentor_id,category_id,title,description,level,objectives,prerequisites,duration_minutes,fee_minor,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'published') RETURNING id",
        [
          mentor.id,
          categories[i % 5].id,
          titles[i],
          "A focused one-to-one session with a Student Mentor. Work on a small practical task, ask questions, and leave with a clear next step. This is fictional demo content.",
          i % 3 === 0 ? "Intermediate" : "Beginner",
          "Complete a guided exercise; explain your approach; plan a practice project.",
          "Bring a laptop and curiosity.",
          i % 4 === 0 ? 30 : 60,
          15000 + (i % 4) * 10000,
        ],
      )
    ).rows[0];
    for (let j = 1; j <= 3; j++) {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + j + 2);
      start.setUTCHours(3 + (i % 7) * 2, 0, 0, 0);
      await db.query(
        "INSERT INTO availability(listing_id,starts_at,ends_at) VALUES($1,$2,$3)",
        [
          l.id,
          start.toISOString(),
          new Date(
            start.getTime() + (i % 4 === 0 ? 30 : 60) * 60000,
          ).toISOString(),
        ],
      );
    }
  }
  await seedExchange(db);
  await seedLearning(db);
  if (process.env.SEED_FINANCE_DEMO === "true") await seedPayments(db);
  if (process.env.SEED_ADMIN_DEMO === "true") await seedAdministration(db);
  if (process.env.SEED_PROJECT_DEMO === "true")
    await seedProjects(db, {
      storage: createLocalStorage(
        process.env.STORAGE_DIR || "./storage/private",
      ),
    });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await seed(pool);
    console.log(
      "Seeded 8 fictional students, 1 admin and 12 listings. Password: StudentDemo!2026",
    );
  } finally {
    await pool.end();
  }
}
