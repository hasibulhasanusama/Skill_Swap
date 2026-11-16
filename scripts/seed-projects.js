import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { pool, transaction } from "../server/db.js";
import { createLocalStorage } from "../server/storage.js";
export async function seedProjects(db, { storage } = {}) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_ENABLED !== "true"
  )
    throw new Error("Project seed requires enabled non-production demo mode.");
  let storedKey;
  try {
    await transaction(db, async (c) => {
      if (
        (
          await c.query(
            "SELECT marker FROM project_demo_fixtures WHERE marker='stage5-approved-project'",
          )
        ).rows.length
      )
        return;
      const mentor = (
          await c.query(
            "SELECT id FROM users WHERE email='student5@skillswap.test'",
          )
        ).rows[0],
        learner = (
          await c.query(
            "SELECT id FROM users WHERE email='student6@skillswap.test'",
          )
        ).rows[0];
      if (!mentor || !learner)
        throw new Error("Run the main student demo seed first.");
      let b = (
        await c.query(
          "SELECT b.* FROM sandbox_demo_fixtures f JOIN bookings b ON b.id=f.booking_id WHERE f.marker='stage4-completed-session' AND b.status='reserved' AND b.learning_status='completed' AND b.learner_confirmed_at IS NOT NULL",
        )
      ).rows[0];
      if (!b) {
        const l = (
          await c.query(
            "SELECT * FROM listings WHERE mentor_id=$1 ORDER BY id LIMIT 1",
            [mentor.id],
          )
        ).rows[0];
        const begins = new Date(Date.now() - 5 * 86400000),
          ends = new Date(begins.getTime() + l.duration_minutes * 60000);
        const slot = (
          await c.query(
            "INSERT INTO availability(listing_id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING id",
            [l.id, begins.toISOString(), ends.toISOString()],
          )
        ).rows[0];
        b = (
          await c.query(
            "INSERT INTO bookings(learner_id,mentor_id,listing_id,slot_id,starts_at,ends_at,amount_minor,payment_required,learning_status,mentor_completed_at,learner_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,false,'completed',$6,$6) RETURNING *",
            [
              learner.id,
              mentor.id,
              l.id,
              slot.id,
              begins.toISOString(),
              ends.toISOString(),
              l.fee_minor,
            ],
          )
        ).rows[0];
      }
      const t = (
        await c.query(
          "INSERT INTO project_tasks(booking_id,mentor_id,learner_id,kind,title,instructions) VALUES($1,$2,$3,'project','Fictional responsive study planner','Demo task: build a responsive weekly study planner with clear labels and a short explanation of layout choices.') RETURNING id",
          [b.id, mentor.id, learner.id],
        )
      ).rows[0];
      let fileId = null;
      if (storage) {
        const bytes = Buffer.from(
          "Fictional Skill Swap demo work sample.\nResponsive study planner notes:\n- Group study blocks by weekday.\n- Use readable labels and visible keyboard focus.\n- Adapt the layout to narrow screens.\n",
        );
        storedKey = await storage.put(bytes);
        fileId = (
          await c.query(
            "INSERT INTO files(owner_id,storage_key,original_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [
              learner.id,
              storedKey,
              "fictional-study-planner.txt",
              "text/plain",
              bytes.length,
            ],
          )
        ).rows[0].id;
      }
      for (const version of [1, 2]) {
        const summary =
          version === 1
            ? "Fictional first draft: a weekly study planner with labelled study blocks."
            : "Fictional revised project: a responsive study planner with readable labels, keyboard focus notes and small-screen layout decisions.";
        const state = version === 1 ? "changes_requested" : "approved";
        const s = (
          await c.query(
            "INSERT INTO project_submissions(task_id,student_id,version,summary,external_url,file_id,status,client_key,content_hash) VALUES($1,$2,$3,$4,'',$5,$6,$7,$8) RETURNING id",
            [
              t.id,
              learner.id,
              version,
              summary,
              version === 2 ? fileId : null,
              state,
              `00000000-0000-4000-8000-00000000500${version}`,
              createHash("sha256").update(summary).digest("hex"),
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO project_feedback(submission_id,mentor_id,verdict,comment) VALUES($1,$2,$3,$4)",
          [
            s.id,
            mentor.id,
            state,
            version === 1
              ? "Fictional mentor feedback: improve small-screen layout and explain keyboard focus."
              : "Fictional mentor feedback: the revised project addresses the agreed task objectives.",
          ],
        );
        if (version === 2)
          await c.query(
            "INSERT INTO portfolio_entries(owner_id,submission_id,title,description,file_id,share_file,visibility) VALUES($1,$2,'Fictional responsive study planner',$3,$4,false,'public')",
            [learner.id, s.id, summary, fileId],
          );
      }
      await c.query(
        "INSERT INTO reviews(booking_id,author_id,subject_id,rating,comment) VALUES($1,$2,$3,5,$4) ON CONFLICT DO NOTHING",
        [
          b.id,
          learner.id,
          mentor.id,
          "Fictional demo review: the Student Mentor explained the practical task and gave useful revision feedback.",
        ],
      );
      await c.query(
        "INSERT INTO saved_skills(user_id,listing_id) VALUES($1,1) ON CONFLICT DO NOTHING",
        [learner.id],
      );
      await c.query(
        "INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,'Your fictional project and portfolio demo are ready.','dashboard/projects','seed:stage5-project') ON CONFLICT DO NOTHING",
        [learner.id],
      );
      await c.query(
        "INSERT INTO project_demo_fixtures(marker,task_id) VALUES('stage5-approved-project',$1)",
        [t.id],
      );
    });
  } catch (e) {
    if (storedKey) await storage.delete(storedKey);
    throw e;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await seedProjects(pool, {
      storage: createLocalStorage(
        process.env.STORAGE_DIR || "./storage/private",
      ),
    });
    console.log(
      "Fictional project revisions, feedback, public portfolio text and eligible review seeded.",
    );
  } finally {
    await pool.end();
  }
}
