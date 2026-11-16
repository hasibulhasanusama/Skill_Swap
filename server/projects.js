import { z } from "zod";
import { createHash } from "node:crypto";
import { transaction } from "./db.js";
import { documentType, safeFilename } from "./storage.js";
import { learningContext } from "./learning.js";
import { requireFundedBooking } from "./payment-ledger.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const id = z.coerce.number().int().positive(),
  short = z.string().trim().min(2).max(120),
  long = z.string().trim().min(10).max(6000);
const external = z
  .string()
  .trim()
  .max(2000)
  .default("")
  .refine((value) => {
    if (!value) return true;
    try {
      const u = new URL(value);
      return u.protocol === "https:" && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Use an HTTPS URL without embedded credentials, or leave it blank.");
const bool = z.preprocess(
  (v) =>
    v === undefined ? false : v === "true" ? true : v === "false" ? false : v,
  z.boolean(),
);
const entrySchema = z.object({
  title: short,
  description: long,
  external_url: external,
  share_file: bool,
  visibility: z.enum(["private", "public"]).default("private"),
});
export const reviewEligibility = `((r.booking_id IS NOT NULL AND b.status='reserved' AND b.learning_status='completed' AND b.learner_confirmed_at IS NOT NULL AND b.learner_id=r.author_id AND b.mentor_id=r.subject_id) OR (r.exchange_id IS NOT NULL AND x.status='completed' AND ((x.requester_id=r.author_id AND x.recipient_id=r.subject_id) OR (x.recipient_id=r.author_id AND x.requester_id=r.subject_id)) AND EXISTS(SELECT 1 FROM exchange_sessions es WHERE es.exchange_id=x.id AND es.teacher_id=r.author_id) AND EXISTS(SELECT 1 FROM exchange_sessions es WHERE es.exchange_id=x.id AND es.teacher_id=r.subject_id) AND NOT EXISTS(SELECT 1 FROM exchange_sessions es WHERE es.exchange_id=x.id AND NOT (es.teacher_completed AND es.learner_confirmed))))`;
const reviewJoins =
  "FROM reviews r JOIN users author ON author.id=r.author_id LEFT JOIN bookings b ON b.id=r.booking_id LEFT JOIN exchanges x ON x.id=r.exchange_id";
const publicReviewWhere = `r.moderation_status='visible' AND author.suspended=false AND author.role='student' AND author.verification='approved' AND ${reviewEligibility}`;
export async function publicReviews(db, subjectId) {
  return (
    await db.query(
      `SELECT r.id,r.rating,r.comment,r.created_at,author.name author_name,CASE WHEN r.booking_id IS NOT NULL THEN 'booking' ELSE 'exchange' END context_kind ${reviewJoins} WHERE r.subject_id=$1 AND ${publicReviewWhere} ORDER BY r.id DESC LIMIT 100`,
      [subjectId],
    )
  ).rows;
}
export async function publicPortfolio(db, ownerId) {
  return (
    await db.query(
      "SELECT p.id,p.title,p.description,p.external_url,p.created_at,(p.share_file AND p.file_id IS NOT NULL) AS has_attachment,(p.submission_id IS NOT NULL) AS reviewed_project FROM portfolio_entries p JOIN users u ON u.id=p.owner_id WHERE p.owner_id=$1 AND p.visibility='public' AND p.moderation_status='visible' AND u.verification='approved' AND u.role='student' AND u.profile_public=true AND u.suspended=false ORDER BY p.id DESC",
      [ownerId],
    )
  ).rows;
}
export async function profileStatistics(db, ownerId) {
  const bookingCount = Number(
    (
      await db.query(
        "SELECT count(*) FROM bookings WHERE mentor_id=$1 AND status='reserved' AND learning_status='completed' AND learner_confirmed_at IS NOT NULL",
        [ownerId],
      )
    ).rows[0].count,
  );
  const exchangeCount = Number(
    (
      await db.query(
        "SELECT count(*) FROM exchange_sessions s JOIN exchanges x ON x.id=s.exchange_id WHERE s.teacher_id=$1 AND s.teacher_completed AND s.learner_confirmed AND x.status IN ('active','completed')",
        [ownerId],
      )
    ).rows[0].count,
  );
  const rating = (
    await db.query(
      `SELECT count(*) review_count,avg(r.rating) average_rating ${reviewJoins} WHERE r.subject_id=$1 AND ${publicReviewWhere}`,
      [ownerId],
    )
  ).rows[0];
  return {
    completed_sessions: bookingCount + exchangeCount,
    review_count: Number(rating.review_count),
    average_rating:
      rating.average_rating === null ? null : Number(rating.average_rating),
  };
}
async function notify(c, user, title, event, route = "dashboard/projects") {
  await c.query(
    "INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [user, title, route, event],
  );
}
async function taskAccess(c, taskId, userId, lock = false) {
  const row = (
    await c.query("SELECT * FROM project_tasks WHERE id=$1", [taskId])
  ).rows[0];
  if (!row || ![row.mentor_id, row.learner_id].includes(userId))
    throw fail(404, "Project task not found.");
  await learningContext(
    c,
    row.booking_id ? "booking" : "exchange",
    row.booking_id || row.exchange_id,
    userId,
    lock,
  );
  return lock
    ? (
        await c.query("SELECT * FROM project_tasks WHERE id=$1 FOR UPDATE", [
          taskId,
        ])
      ).rows[0]
    : row;
}
function mime(file) {
  if (!file) return null;
  const type = documentType(file.buffer);
  if (type) return type;
  if (/\.(txt|md)$/i.test(file.originalname) && !file.buffer.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(file.buffer);
      return "text/plain";
    } catch {}
  }
  throw fail(400, "Use a PDF, PNG, JPEG or UTF-8 TXT/MD file, up to 5 MB.");
}
async function storeWork(c, storage, userId, file, type) {
  const storageKey = await storage.put(file.buffer);
  try {
    const record = (
      await c.query(
        "INSERT INTO files(owner_id,storage_key,original_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [userId, storageKey, safeFilename(file.originalname), type, file.size],
      )
    ).rows[0];
    return { record, storageKey };
  } catch (e) {
    await storage.delete(storageKey);
    throw e;
  }
}
export function mountProjects(
  app,
  { db, login, approved, admin, upload, storage },
) {
  app.get("/api/projects/contexts", login, async (req, res) => {
    const b = (
      await db.query(
        "SELECT b.id,l.title,u.name learner_name FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users u ON u.id=b.learner_id WHERE b.mentor_id=$1 AND b.status='reserved' AND (NOT b.payment_required OR EXISTS(SELECT 1 FROM payment_allocations a WHERE a.booking_id=b.id AND a.status<>'refunded')) ORDER BY b.id DESC",
        [req.user.id],
      )
    ).rows;
    const x = (
      await db.query(
        "SELECT x.id,x.requester_skill,x.recipient_skill,u.name learner_name FROM exchanges x JOIN users u ON u.id=CASE WHEN x.requester_id=$1 THEN x.recipient_id ELSE x.requester_id END WHERE (x.requester_id=$1 OR x.recipient_id=$1) AND x.status IN ('active','completed') AND EXISTS(SELECT 1 FROM exchange_sessions s WHERE s.exchange_id=x.id AND s.teacher_id=$1) ORDER BY x.id DESC",
        [req.user.id],
      )
    ).rows;
    res.json({
      items: [
        ...b.map((v) => ({ ...v, context_kind: "booking" })),
        ...x.map((v) => ({
          ...v,
          title: `${v.requester_skill} ↔ ${v.recipient_skill}`,
          context_kind: "exchange",
        })),
      ],
    });
  });
  app.get("/api/projects/tasks", login, async (req, res) => {
    const items = (
      await db.query(
        `SELECT t.*,m.name mentor_name,u.name learner_name,s.id latest_submission_id,s.status latest_status,s.version latest_version FROM project_tasks t JOIN users m ON m.id=t.mentor_id JOIN users u ON u.id=t.learner_id LEFT JOIN project_submissions s ON s.id=(SELECT id FROM project_submissions WHERE task_id=t.id ORDER BY version DESC LIMIT 1) WHERE t.mentor_id=$1 OR t.learner_id=$1 ORDER BY t.id DESC`,
        [req.user.id],
      )
    ).rows;
    res.json({
      items,
      progress: {
        assigned_to_me: items.filter((t) => t.learner_id === req.user.id)
          .length,
        approved: items.filter(
          (t) => t.learner_id === req.user.id && t.latest_status === "approved",
        ).length,
        awaiting_my_feedback: items.filter(
          (t) => t.mentor_id === req.user.id && t.latest_status === "submitted",
        ).length,
      },
    });
  });
  app.post("/api/projects/tasks", approved, async (req, res) => {
    const body = z
      .object({
        context_kind: z.enum(["booking", "exchange"]),
        context_id: id,
        kind: z.enum(["exercise", "project"]),
        title: short,
        instructions: long,
        due_at: z.iso.datetime({ offset: true }).nullable().optional(),
      })
      .parse(req.body);
    const t = await transaction(db, async (c) => {
      const ctx = await learningContext(
        c,
        body.context_kind,
        body.context_id,
        req.user.id,
        true,
      );
      if (body.context_kind === "booking") {
        if (ctx.record.mentor_id !== req.user.id)
          throw fail(403, "Only the Student Mentor can assign a task.");
        if (ctx.record.status !== "reserved")
          throw fail(409, "Cancelled bookings cannot receive tasks.");
        await requireFundedBooking(c, ctx.record);
      } else {
        if (!["active", "completed"].includes(ctx.record.status))
          throw fail(
            409,
            "Activate an exchange agreement before assigning tasks.",
          );
        if (
          !(
            await c.query(
              "SELECT id FROM exchange_sessions WHERE exchange_id=$1 AND teacher_id=$2",
              [body.context_id, req.user.id],
            )
          ).rows.length
        )
          throw fail(403, "You must teach an agreed exchange session.");
      }
      if (body.due_at && Date.parse(body.due_at) <= Date.now())
        throw fail(400, "Choose a future due date or leave it blank.");
      const learner = ctx.participants.find((p) => p !== req.user.id);
      const t = (
        await c.query(
          `INSERT INTO project_tasks(${body.context_kind === "booking" ? "booking_id" : "exchange_id"},mentor_id,learner_id,kind,title,instructions,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            body.context_id,
            req.user.id,
            learner,
            body.kind,
            body.title,
            body.instructions,
            body.due_at || null,
          ],
        )
      ).rows[0];
      await notify(
        c,
        learner,
        "A new exercise or project was assigned.",
        `task:${t.id}`,
      );
      return t;
    });
    res
      .status(201)
      .json({ task: t, message: "Task assigned to your learning partner." });
  });
  app.get("/api/projects/tasks/:id", login, async (req, res) => {
    const t = await taskAccess(db, id.parse(req.params.id), req.user.id);
    const names = (
      await db.query("SELECT id,name FROM users WHERE id IN ($1,$2)", [
        t.mentor_id,
        t.learner_id,
      ])
    ).rows;
    const submissions = (
      await db.query(
        "SELECT s.*,f.original_name,f.size_bytes,fb.comment feedback,fb.verdict,fb.created_at feedback_at,p.id portfolio_id FROM project_submissions s LEFT JOIN files f ON f.id=s.file_id LEFT JOIN project_feedback fb ON fb.submission_id=s.id LEFT JOIN portfolio_entries p ON p.submission_id=s.id WHERE s.task_id=$1 ORDER BY s.version DESC",
        [t.id],
      )
    ).rows;
    const ctx = await learningContext(
      db,
      t.booking_id ? "booking" : "exchange",
      t.booking_id || t.exchange_id,
      req.user.id,
    );
    const active = t.booking_id
      ? ctx.record.status === "reserved" &&
        (!ctx.record.payment_required ||
          (
            await db.query(
              "SELECT id FROM payment_allocations WHERE booking_id=$1 AND status<>'refunded'",
              [t.booking_id],
            )
          ).rows.length > 0)
      : ["active", "completed"].includes(ctx.record.status);
    res.json({
      task: t,
      participants: names,
      submissions,
      accepts_submissions: active,
    });
  });
  app.post(
    "/api/projects/tasks/:id/submissions",
    approved,
    upload.single("work"),
    async (req, res) => {
      const taskId = id.parse(req.params.id),
        body = z
          .object({
            summary: long,
            external_url: external,
            client_key: z.uuid(),
          })
          .parse(req.body),
        file = req.file,
        type = mime(file);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            summary: body.summary,
            url: body.external_url,
            name: file ? safeFilename(file.originalname) : "",
            file: file
              ? createHash("sha256").update(file.buffer).digest("hex")
              : "",
          }),
        )
        .digest("hex");
      let storageKey;
      try {
        const result = await transaction(db, async (c) => {
          const t = await taskAccess(c, taskId, req.user.id, true);
          if (t.learner_id !== req.user.id)
            throw fail(403, "Only the assigned learner may submit work.");
          const old = (
            await c.query(
              "SELECT * FROM project_submissions WHERE student_id=$1 AND client_key=$2",
              [req.user.id, body.client_key],
            )
          ).rows[0];
          if (old) {
            if (old.task_id !== t.id || old.content_hash !== fingerprint)
              throw fail(
                409,
                "Submission key was already used for different work.",
              );
            return old;
          }
          const ctx = await learningContext(
            c,
            t.booking_id ? "booking" : "exchange",
            t.booking_id || t.exchange_id,
            req.user.id,
          );
          if (t.booking_id) {
            if (ctx.record.status !== "reserved")
              throw fail(409, "The related booking is cancelled.");
            await requireFundedBooking(c, ctx.record);
          } else if (!["active", "completed"].includes(ctx.record.status))
            throw fail(409, "The related exchange is no longer active.");
          const latest = (
            await c.query(
              "SELECT * FROM project_submissions WHERE task_id=$1 ORDER BY version DESC LIMIT 1",
              [t.id],
            )
          ).rows[0];
          if (latest && latest.status !== "changes_requested")
            throw fail(
              409,
              latest.status === "approved"
                ? "This work is already approved."
                : "Wait for mentor feedback before resubmitting.",
            );
          let fileId = null;
          if (file) {
            const saved = await storeWork(c, storage, req.user.id, file, type);
            storageKey = saved.storageKey;
            fileId = saved.record.id;
          }
          const s = (
            await c.query(
              "INSERT INTO project_submissions(task_id,student_id,version,summary,external_url,file_id,client_key,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
              [
                t.id,
                req.user.id,
                (latest?.version || 0) + 1,
                body.summary,
                body.external_url,
                fileId,
                body.client_key,
                fingerprint,
              ],
            )
          ).rows[0];
          await notify(
            c,
            t.mentor_id,
            "A learner submitted work for feedback.",
            `submission:${s.id}`,
          );
          return s;
        });
        res
          .status(201)
          .json({
            submission: result,
            message: "Work submitted privately to your Student Mentor.",
          });
      } catch (e) {
        if (storageKey) await storage.delete(storageKey);
        throw e;
      }
    },
  );
  app.post(
    "/api/project-submissions/:id/feedback",
    approved,
    async (req, res) => {
      const submissionId = id.parse(req.params.id),
        body = z
          .object({
            verdict: z.enum(["approved", "changes_requested"]),
            comment: long,
          })
          .parse(req.body);
      await transaction(db, async (c) => {
        const original = (
          await c.query("SELECT task_id FROM project_submissions WHERE id=$1", [
            submissionId,
          ])
        ).rows[0];
        if (!original) throw fail(404, "Submission not found.");
        const t = await taskAccess(c, original.task_id, req.user.id, true);
        if (t.mentor_id !== req.user.id)
          throw fail(
            403,
            "Only the assigned Student Mentor may review this work.",
          );
        const s = (
          await c.query(
            "SELECT * FROM project_submissions WHERE id=$1 FOR UPDATE",
            [submissionId],
          )
        ).rows[0];
        const latest = (
          await c.query(
            "SELECT id FROM project_submissions WHERE task_id=$1 ORDER BY version DESC LIMIT 1",
            [t.id],
          )
        ).rows[0];
        if (s.status !== "submitted" || latest.id !== s.id)
          throw fail(409, "This version was already reviewed or superseded.");
        await c.query(
          "INSERT INTO project_feedback(submission_id,mentor_id,verdict,comment) VALUES($1,$2,$3,$4)",
          [s.id, req.user.id, body.verdict, body.comment],
        );
        await c.query("UPDATE project_submissions SET status=$1 WHERE id=$2", [
          body.verdict,
          s.id,
        ]);
        await notify(
          c,
          t.learner_id,
          "Your Student Mentor left project feedback.",
          `feedback:${s.id}`,
        );
      });
      res.json({
        message:
          "Feedback recorded. Previous work and feedback remain in version history.",
      });
    },
  );
  app.get("/api/portfolio", login, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT p.*,f.original_name FROM portfolio_entries p LEFT JOIN files f ON f.id=p.file_id WHERE p.owner_id=$1 ORDER BY p.id DESC",
          [req.user.id],
        )
      ).rows,
    }),
  );
  app.post(
    "/api/project-submissions/:id/portfolio",
    approved,
    async (req, res) => {
      const submissionId = id.parse(req.params.id),
        body = entrySchema.parse(req.body);
      const result = await transaction(db, async (c) => {
        const s = (
          await c.query("SELECT * FROM project_submissions WHERE id=$1", [
            submissionId,
          ])
        ).rows[0];
        if (!s || s.student_id !== req.user.id)
          throw fail(404, "Approved submission not found.");
        await taskAccess(c, s.task_id, req.user.id, true);
        if (s.status !== "approved")
          throw fail(
            409,
            "Only mentor-approved work can be added through this action.",
          );
        if (body.share_file && !s.file_id)
          throw fail(400, "This submission has no attachment to share.");
        return (
          await c.query(
            "INSERT INTO portfolio_entries(owner_id,submission_id,title,description,external_url,file_id,share_file,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
            [
              req.user.id,
              s.id,
              body.title,
              body.description,
              body.external_url,
              s.file_id,
              body.share_file,
              body.visibility,
            ],
          )
        ).rows[0];
      });
      res
        .status(201)
        .json({
          entry: result,
          message:
            "Portfolio entry saved with your chosen visibility. Publishing is your choice.",
        });
    },
  );
  app.post(
    "/api/portfolio",
    approved,
    upload.single("work"),
    async (req, res) => {
      const body = entrySchema.parse(req.body),
        file = req.file,
        type = mime(file);
      if (body.share_file && !file)
        throw fail(400, "Choose an attachment before enabling file sharing.");
      let storageKey;
      try {
        const result = await transaction(db, async (c) => {
          let fileId = null;
          if (file) {
            const saved = await storeWork(c, storage, req.user.id, file, type);
            storageKey = saved.storageKey;
            fileId = saved.record.id;
          }
          return (
            await c.query(
              "INSERT INTO portfolio_entries(owner_id,title,description,external_url,file_id,share_file,visibility) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
              [
                req.user.id,
                body.title,
                body.description,
                body.external_url,
                fileId,
                body.share_file,
                body.visibility,
              ],
            )
          ).rows[0];
        });
        res
          .status(201)
          .json({
            entry: result,
            message: "Independent portfolio project saved.",
          });
      } catch (e) {
        if (storageKey) await storage.delete(storageKey);
        throw e;
      }
    },
  );
  app.put("/api/portfolio/:id", login, async (req, res) => {
    const body = entrySchema.parse(req.body);
    if (
      body.visibility === "public" &&
      (req.user.role !== "student" || req.user.verification !== "approved")
    )
      throw fail(
        403,
        "Approved student verification is required to publish. You can still save this entry privately.",
      );
    const result = await transaction(db, async (c) => {
      const p = (
        await c.query(
          "SELECT * FROM portfolio_entries WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id.parse(req.params.id), req.user.id],
        )
      ).rows[0];
      if (!p) throw fail(404, "Portfolio entry not found.");
      if (body.share_file && !p.file_id)
        throw fail(400, "This portfolio entry has no attachment.");
      return (
        await c.query(
          "UPDATE portfolio_entries SET title=$1,description=$2,external_url=$3,share_file=$4,visibility=$5,updated_at=now() WHERE id=$6 RETURNING *",
          [
            body.title,
            body.description,
            body.external_url,
            body.share_file,
            body.visibility,
            p.id,
          ],
        )
      ).rows[0];
    });
    res.json({
      entry: result,
      message:
        "Portfolio changes saved. Private or hidden entries are not publicly accessible.",
    });
  });
  async function visibleEntry(entryId) {
    const p = (
      await db.query(
        "SELECT p.*,u.name owner_name,u.institution FROM portfolio_entries p JOIN users u ON u.id=p.owner_id WHERE p.id=$1 AND p.visibility='public' AND p.moderation_status='visible' AND u.verification='approved' AND u.role='student' AND u.profile_public=true AND u.suspended=false",
        [entryId],
      )
    ).rows[0];
    if (!p) throw fail(404, "Public portfolio entry not found.");
    return p;
  }
  app.get("/api/portfolio/:id", async (req, res) => {
    const p = await visibleEntry(id.parse(req.params.id));
    res.json({
      entry: {
        id: p.id,
        owner_id: p.owner_id,
        owner_name: p.owner_name,
        institution: p.institution,
        title: p.title,
        description: p.description,
        external_url: p.external_url,
        reviewed_project: p.submission_id !== null,
        has_attachment: p.share_file && p.file_id !== null,
        created_at: p.created_at,
      },
    });
  });
  app.get("/api/portfolio/:id/file", async (req, res) => {
    const p = await visibleEntry(id.parse(req.params.id));
    if (!p.share_file || !p.file_id)
      throw fail(404, "Public attachment not found.");
    const f = (await db.query("SELECT * FROM files WHERE id=$1", [p.file_id]))
      .rows[0];
    if (!f) throw fail(404, "Public attachment not found.");
    res
      .type(f.mime_type)
      .attachment(safeFilename(f.original_name))
      .send(await storage.read(f.storage_key));
  });
  app.get("/api/reviews", login, async (req, res) => {
    const issued = (
      await db.query(
        `SELECT r.*,u.name subject_name,${reviewEligibility} AS eligible_now FROM reviews r JOIN users u ON u.id=r.subject_id LEFT JOIN bookings b ON b.id=r.booking_id LEFT JOIN exchanges x ON x.id=r.exchange_id WHERE r.author_id=$1 ORDER BY r.id DESC`,
        [req.user.id],
      )
    ).rows;
    const eligibleBookings = (
      await db.query(
        "SELECT b.id,l.title,b.mentor_id subject_id,u.name subject_name FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users u ON u.id=b.mentor_id WHERE b.learner_id=$1 AND b.status='reserved' AND b.learning_status='completed' AND b.learner_confirmed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.booking_id=b.id AND r.author_id=$1) ORDER BY b.id DESC",
        [req.user.id],
      )
    ).rows;
    const eligibleExchanges = (
      await db.query(
        "SELECT x.id,x.requester_skill,x.recipient_skill,u.id subject_id,u.name subject_name FROM exchanges x JOIN users u ON u.id=CASE WHEN x.requester_id=$1 THEN x.recipient_id ELSE x.requester_id END WHERE (x.requester_id=$1 OR x.recipient_id=$1) AND x.status='completed' AND EXISTS(SELECT 1 FROM exchange_sessions s WHERE s.exchange_id=x.id AND s.teacher_id=x.requester_id) AND EXISTS(SELECT 1 FROM exchange_sessions s WHERE s.exchange_id=x.id AND s.teacher_id=x.recipient_id) AND NOT EXISTS(SELECT 1 FROM exchange_sessions s WHERE s.exchange_id=x.id AND NOT (s.teacher_completed AND s.learner_confirmed)) AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.exchange_id=x.id AND r.author_id=$1) ORDER BY x.id DESC",
        [req.user.id],
      )
    ).rows;
    res.json({
      issued,
      received: await publicReviews(db, req.user.id),
      eligible: [
        ...eligibleBookings.map((b) => ({ ...b, context_kind: "booking" })),
        ...eligibleExchanges.map((x) => ({
          ...x,
          title: `${x.requester_skill} ↔ ${x.recipient_skill}`,
          context_kind: "exchange",
        })),
      ],
    });
  });
  app.post("/api/reviews", approved, async (req, res) => {
    const body = z
      .object({
        context_kind: z.enum(["booking", "exchange"]),
        context_id: id,
        rating: z.number().int().min(1).max(5),
        comment: long,
      })
      .parse(req.body);
    const result = await transaction(db, async (c) => {
      const ctx = await learningContext(
        c,
        body.context_kind,
        body.context_id,
        req.user.id,
        true,
      );
      let subject;
      if (body.context_kind === "booking") {
        const b = ctx.record;
        if (
          b.learner_id !== req.user.id ||
          b.status !== "reserved" ||
          b.learning_status !== "completed" ||
          !b.learner_confirmed_at
        )
          throw fail(
            403,
            "Only the learner of a confirmed completed booking can review its Student Mentor.",
          );
        subject = b.mentor_id;
      } else {
        const x = ctx.record;
        const sessions = (
          await c.query(
            "SELECT * FROM exchange_sessions WHERE exchange_id=$1",
            [x.id],
          )
        ).rows;
        if (
          x.status !== "completed" ||
          !sessions.some((s) => s.teacher_id === x.requester_id) ||
          !sessions.some((s) => s.teacher_id === x.recipient_id) ||
          sessions.some((s) => !s.teacher_completed || !s.learner_confirmed)
        )
          throw fail(
            403,
            "Both teaching directions must be completed and confirmed before an exchange review.",
          );
        subject = ctx.participants.find((p) => p !== req.user.id);
      }
      if (subject === req.user.id)
        throw fail(400, "Self-reviews are not allowed.");
      return (
        await c.query(
          `INSERT INTO reviews(${body.context_kind === "booking" ? "booking_id" : "exchange_id"},author_id,subject_id,rating,comment) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [body.context_id, req.user.id, subject, body.rating, body.comment],
        )
      ).rows[0];
    });
    res
      .status(201)
      .json({
        review: result,
        message: "Eligible participant review recorded.",
      });
  });
  app.get("/api/saved-skills", login, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT l.*,u.name mentor_name,u.profile_public mentor_profile_public,c.name category FROM saved_skills s JOIN listings l ON l.id=s.listing_id JOIN users u ON u.id=l.mentor_id JOIN categories c ON c.id=l.category_id WHERE s.user_id=$1 AND l.status='published' AND l.moderation_status='visible' AND EXISTS(SELECT 1 FROM categories cat WHERE cat.id=l.category_id AND cat.active=true) AND u.verification='approved' AND u.role='student' AND u.suspended=false ORDER BY l.id DESC",
          [req.user.id],
        )
      ).rows,
    }),
  );
  app.post("/api/saved-skills/:id", login, async (req, res) => {
    const listingId = id.parse(req.params.id);
    if (
      !(
        await db.query(
          "SELECT l.id FROM listings l JOIN users u ON u.id=l.mentor_id WHERE l.id=$1 AND l.status='published' AND l.moderation_status='visible' AND EXISTS(SELECT 1 FROM categories cat WHERE cat.id=l.category_id AND cat.active=true) AND u.verification='approved' AND u.role='student' AND u.suspended=false",
          [listingId],
        )
      ).rows.length
    )
      throw fail(404, "Published listing not found.");
    await db.query(
      "INSERT INTO saved_skills(user_id,listing_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [req.user.id, listingId],
    );
    res.json({ message: "Skill saved to your account." });
  });
  app.delete("/api/saved-skills/:id", login, async (req, res) => {
    await db.query(
      "DELETE FROM saved_skills WHERE user_id=$1 AND listing_id=$2",
      [req.user.id, id.parse(req.params.id)],
    );
    res.json({ message: "Skill removed from your saved list." });
  });
  app.get("/api/admin/reviews", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT r.*,a.name author_name,u.name subject_name FROM reviews r JOIN users a ON a.id=r.author_id JOIN users u ON u.id=r.subject_id ORDER BY r.id DESC LIMIT 200",
        )
      ).rows,
    }),
  );
  app.get("/api/admin/portfolios", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT p.*,u.name owner_name FROM portfolio_entries p JOIN users u ON u.id=p.owner_id ORDER BY p.id DESC LIMIT 200",
        )
      ).rows,
    }),
  );
  for (const [route, table] of [
    ["reviews", "reviews"],
    ["portfolios", "portfolio_entries"],
  ])
    app.post(`/api/admin/${route}/:id/moderate`, admin, async (req, res) => {
      const body = z
        .object({
          status: z.enum(["visible", "hidden"]),
          reason: z.string().trim().min(10).max(3000),
        })
        .parse(req.body);
      await transaction(db, async (c) => {
        const r = (
          await c.query(
            `UPDATE ${table} SET moderation_status=$1,moderation_reason=$2,moderated_by=$3 WHERE id=$4 RETURNING id`,
            [body.status, body.reason, req.user.id, id.parse(req.params.id)],
          )
        ).rows[0];
        if (!r) throw fail(404, "Record not found.");
        await c.query(
          "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
          [req.user.id, `${route}.${body.status}`, String(r.id), body.reason],
        );
      });
      res.json({ message: "Moderation decision and reason recorded." });
    });
}
