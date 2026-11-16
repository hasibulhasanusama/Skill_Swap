import { z } from "zod";
import { transaction } from "./db.js";
import { matchStudents, normalizeSkill } from "./matching.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const skill = z.string().trim().min(2).max(80).transform(normalizeSkill);
const schedule = z
  .object({
    weekday: z.number().int().min(0).max(6),
    start_minute: z.number().int().min(0).max(1439),
    end_minute: z.number().int().min(1).max(1440),
  })
  .refine(
    (x) => x.end_minute - x.start_minute >= 15,
    "Availability must be at least 15 minutes.",
  );
async function participant(c, id, userId) {
  const x = (
    await c.query("SELECT * FROM exchanges WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  if (!x || ![x.requester_id, x.recipient_id].includes(userId))
    throw fail(404, "Exchange not found.");
  return x;
}
export async function checkSchedule(c, x, sessions) {
  await c.query(
    "SELECT id FROM users WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",
    [x.requester_id, x.recipient_id],
  );
  for (const s of sessions) {
    const b = await c.query(
      "SELECT id FROM bookings WHERE status='reserved' AND (learner_id IN ($1,$2) OR mentor_id IN ($1,$2)) AND starts_at<$4 AND ends_at>$3",
      [x.requester_id, x.recipient_id, s.starts_at, s.ends_at],
    );
    const e = await c.query(
      "SELECT s.id FROM exchange_sessions s JOIN exchanges e ON e.id=s.exchange_id WHERE e.status='active' AND e.id<>$5 AND (e.requester_id IN ($1,$2) OR e.recipient_id IN ($1,$2)) AND s.starts_at<$4 AND s.ends_at>$3",
      [x.requester_id, x.recipient_id, s.starts_at, s.ends_at, x.id],
    );
    if (b.rows.length || e.rows.length)
      throw fail(
        409,
        "A participant already has a session during the proposed time.",
      );
  }
}
export function mountExchanges(app, { db, login, approved, admin }) {
  app.get("/api/exchange/preferences", login, async (req, res) =>
    res.json({
      skills: (
        await db.query(
          "SELECT * FROM skill_preferences WHERE user_id=$1 ORDER BY kind,skill",
          [req.user.id],
        )
      ).rows,
      availability: (
        await db.query(
          "SELECT * FROM exchange_availability WHERE user_id=$1 ORDER BY weekday,start_minute",
          [req.user.id],
        )
      ).rows,
      timezone: "Asia/Dhaka",
    }),
  );
  app.put("/api/exchange/preferences", login, async (req, res) => {
    if (req.user.role !== "student")
      throw fail(403, "Student account required.");
    const b = z
      .object({
        skills: z
          .array(
            z.object({
              skill,
              kind: z.enum(["teach", "learn"]),
              level: z.number().int().min(1).max(3),
            }),
          )
          .max(30),
        availability: z.array(schedule).max(30),
      })
      .parse(req.body);
    const seen = new Set();
    for (const s of b.skills) {
      const key = s.kind + ":" + s.skill;
      if (seen.has(key)) throw fail(400, "Duplicate skill preference.");
      seen.add(key);
    }
    for (let i = 0; i < b.availability.length; i++)
      for (let j = i + 1; j < b.availability.length; j++) {
        const a = b.availability[i],
          c = b.availability[j];
        if (
          a.weekday === c.weekday &&
          a.start_minute < c.end_minute &&
          c.start_minute < a.end_minute
        )
          throw fail(400, "Your recurring availability overlaps.");
      }
    await transaction(db, async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.user.id,
      ]);
      await c.query("DELETE FROM skill_preferences WHERE user_id=$1", [
        req.user.id,
      ]);
      await c.query("DELETE FROM exchange_availability WHERE user_id=$1", [
        req.user.id,
      ]);
      for (const s of b.skills)
        await c.query(
          "INSERT INTO skill_preferences(user_id,skill,kind,level) VALUES($1,$2,$3,$4)",
          [req.user.id, s.skill, s.kind, s.level],
        );
      for (const a of b.availability)
        await c.query(
          "INSERT INTO exchange_availability(user_id,weekday,start_minute,end_minute) VALUES($1,$2,$3,$4)",
          [req.user.id, a.weekday, a.start_minute, a.end_minute],
        );
    });
    res.json({ message: "Skills and recurring availability saved." });
  });
  app.get("/api/exchange/matches", approved, async (req, res) => {
    const prefs = (await db.query("SELECT * FROM skill_preferences")).rows,
      slots = (await db.query("SELECT * FROM exchange_availability")).rows;
    const users = (
      await db.query(
        "SELECT id,name,institution FROM users WHERE role='student' AND verification='approved' AND suspended=false AND id<>$1",
        [req.user.id],
      )
    ).rows;
    const items = users
      .flatMap((u) => {
        const match = matchStudents(
          prefs.filter((p) => p.user_id === req.user.id),
          prefs.filter((p) => p.user_id === u.id),
          slots.filter((p) => p.user_id === req.user.id),
          slots.filter((p) => p.user_id === u.id),
        );
        return match ? [{ student: u, ...match }] : [];
      })
      .sort((a, b) => b.score - a.score || a.student.id - b.student.id);
    res.json({
      items,
      method:
        "Rules-based complementary skills, proficiency and recurring availability.",
    });
  });
  app.post("/api/exchanges", approved, async (req, res) => {
    const b = z
      .object({
        recipient_id: z.number().int().positive(),
        requester_skill: skill,
        recipient_skill: skill,
        message: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    if (b.recipient_id === req.user.id)
      throw fail(400, "You cannot exchange with yourself.");
    const target = (
      await db.query(
        "SELECT id FROM users WHERE id=$1 AND role='student' AND verification='approved' AND suspended=false",
        [b.recipient_id],
      )
    ).rows[0];
    if (!target) throw fail(400, "Choose an approved student.");
    const prefs = (
      await db.query(
        "SELECT * FROM skill_preferences WHERE user_id IN ($1,$2)",
        [req.user.id, b.recipient_id],
      )
    ).rows;
    const slots = (
      await db.query(
        "SELECT * FROM exchange_availability WHERE user_id IN ($1,$2)",
        [req.user.id, b.recipient_id],
      )
    ).rows;
    const m = matchStudents(
      prefs.filter((p) => p.user_id === req.user.id),
      prefs.filter((p) => p.user_id === b.recipient_id),
      slots.filter((p) => p.user_id === req.user.id),
      slots.filter((p) => p.user_id === b.recipient_id),
    );
    if (
      !m ||
      !m.give.includes(b.requester_skill) ||
      !m.receive.includes(b.recipient_skill)
    )
      throw fail(
        400,
        "The selected skills and recurring availability do not form a compatible match.",
      );
    const x = (
      await db.query(
        "INSERT INTO exchanges(requester_id,recipient_id,requester_skill,recipient_skill,message) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          req.user.id,
          b.recipient_id,
          b.requester_skill,
          b.recipient_skill,
          b.message,
        ],
      )
    ).rows[0];
    res.status(201).json({ exchange: x });
  });
  app.get("/api/exchanges", login, async (req, res) => {
    const items = (
      await db.query(
        "SELECT e.*,a.name requester_name,b.name recipient_name FROM exchanges e JOIN users a ON a.id=e.requester_id JOIN users b ON b.id=e.recipient_id WHERE e.requester_id=$1 OR e.recipient_id=$1 ORDER BY e.id DESC",
        [req.user.id],
      )
    ).rows;
    const sessions = (
      await db.query(
        "SELECT s.* FROM exchange_sessions s JOIN exchanges e ON e.id=s.exchange_id WHERE e.requester_id=$1 OR e.recipient_id=$1 ORDER BY s.starts_at",
        [req.user.id],
      )
    ).rows;
    const reports = (
      await db.query(
        "SELECT r.* FROM exchange_reports r JOIN exchanges e ON e.id=r.exchange_id WHERE e.requester_id=$1 OR e.recipient_id=$1 ORDER BY r.id DESC",
        [req.user.id],
      )
    ).rows;
    res.json({
      items: items.map((x) => ({
        ...x,
        sessions: sessions.filter((s) => s.exchange_id === x.id),
        reports: reports.filter((r) => r.exchange_id === x.id),
      })),
    });
  });
  app.post("/api/exchanges/:id/respond", approved, async (req, res) => {
    const { action } = z
      .object({ action: z.enum(["accept", "reject", "cancel"]) })
      .parse(req.body);
    await transaction(db, async (c) => {
      const x = await participant(c, Number(req.params.id), req.user.id);
      let status;
      if (action === "cancel") {
        if (!["pending", "negotiating"].includes(x.status))
          throw fail(
            409,
            "Only pending or negotiating exchanges can be cancelled. Report unfulfilled active agreements instead.",
          );
        status = "cancelled";
      } else {
        if (req.user.id !== x.recipient_id || x.status !== "pending")
          throw fail(
            409,
            "Only the recipient can respond to a pending request.",
          );
        status = action === "accept" ? "negotiating" : "rejected";
      }
      await c.query(
        "UPDATE exchanges SET status=$1,updated_at=now() WHERE id=$2",
        [status, x.id],
      );
    });
    res.json({ message: "Exchange request updated." });
  });
  app.put("/api/exchanges/:id/agreement", approved, async (req, res) => {
    const b = z
      .object({
        revision: z.number().int().min(0),
        requester_objective: z.string().trim().min(5).max(2000),
        recipient_objective: z.string().trim().min(5).max(2000),
        sessions: z
          .array(
            z.object({
              teacher_id: z.number().int().positive(),
              starts_at: z.iso.datetime({ offset: true }),
              duration_minutes: z.number().int().min(15).max(180),
            }),
          )
          .min(2)
          .max(20),
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      const x = await participant(c, Number(req.params.id), req.user.id);
      if (x.status !== "negotiating" || x.revision !== b.revision)
        throw fail(
          409,
          "Agreement changed or is no longer editable. Reload it.",
        );
      if (
        !b.sessions.some((s) => s.teacher_id === x.requester_id) ||
        !b.sessions.some((s) => s.teacher_id === x.recipient_id) ||
        b.sessions.some(
          (s) => ![x.requester_id, x.recipient_id].includes(s.teacher_id),
        )
      )
        throw fail(400, "Each participant must teach at least one session.");
      const sessions = b.sessions
        .map((s) => ({
          ...s,
          ends_at: new Date(
            Date.parse(s.starts_at) + s.duration_minutes * 60000,
          ).toISOString(),
        }))
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
      for (let i = 0; i < sessions.length; i++) {
        if (Date.parse(sessions[i].starts_at) <= Date.now())
          throw fail(400, "All sessions must start in the future.");
        if (
          i &&
          Date.parse(sessions[i].starts_at) <
            Date.parse(sessions[i - 1].ends_at)
        )
          throw fail(400, "Agreement sessions overlap.");
      }
      await checkSchedule(c, x, sessions);
      await c.query("DELETE FROM exchange_sessions WHERE exchange_id=$1", [
        x.id,
      ]);
      for (const s of sessions)
        await c.query(
          "INSERT INTO exchange_sessions(exchange_id,teacher_id,starts_at,ends_at) VALUES($1,$2,$3,$4)",
          [x.id, s.teacher_id, s.starts_at, s.ends_at],
        );
      await c.query(
        "UPDATE exchanges SET requester_objective=$1,recipient_objective=$2,requester_accepted=false,recipient_accepted=false,revision=revision+1,updated_at=now() WHERE id=$3",
        [b.requester_objective, b.recipient_objective, x.id],
      );
    });
    res.json({
      message: "Agreement saved. Both participants must accept this revision.",
    });
  });
  app.post(
    "/api/exchanges/:id/accept-agreement",
    approved,
    async (req, res) => {
      const { revision } = z
        .object({ revision: z.number().int().positive() })
        .parse(req.body);
      await transaction(db, async (c) => {
        const x = await participant(c, Number(req.params.id), req.user.id);
        if (x.status !== "negotiating" || revision !== x.revision)
          throw fail(
            409,
            "Agreement changed or is no longer awaiting acceptance.",
          );
        const sessions = (
          await c.query(
            "SELECT * FROM exchange_sessions WHERE exchange_id=$1",
            [x.id],
          )
        ).rows;
        if (
          !sessions.length ||
          sessions.some((s) => Date.parse(s.starts_at) <= Date.now())
        )
          throw fail(409, "Save a future schedule before accepting.");
        const users = (
          await c.query(
            "SELECT id FROM users WHERE id IN ($1,$2) AND verification='approved' AND suspended=false",
            [x.requester_id, x.recipient_id],
          )
        ).rows;
        if (users.length !== 2)
          throw fail(409, "Both students must remain approved and active.");
        await checkSchedule(c, x, sessions);
        const mine =
          req.user.id === x.requester_id
            ? "requester_accepted"
            : "recipient_accepted";
        if (x[mine]) throw fail(409, "You already accepted this revision.");
        const active =
          mine === "requester_accepted"
            ? x.recipient_accepted
            : x.requester_accepted;
        await c.query(
          `UPDATE exchanges SET ${mine}=true,status=$1,updated_at=now() WHERE id=$2`,
          [active ? "active" : "negotiating", x.id],
        );
      });
      res.json({
        message:
          "Your acceptance was recorded. The agreement activates after both accept.",
      });
    },
  );
  app.post(
    "/api/exchanges/:id/sessions/:sessionId/complete",
    approved,
    async (req, res) => {
      await transaction(db, async (c) => {
        const x = await participant(c, Number(req.params.id), req.user.id);
        if (x.status !== "active")
          throw fail(409, "Only active agreements can record completion.");
        const s = (
          await c.query(
            "SELECT * FROM exchange_sessions WHERE id=$1 AND exchange_id=$2 FOR UPDATE",
            [Number(req.params.sessionId), x.id],
          )
        ).rows[0];
        if (!s) throw fail(404, "Session not found.");
        if (Date.parse(s.ends_at) > Date.now())
          throw fail(
            409,
            "Record completion after the scheduled session ends.",
          );
        const field =
          s.teacher_id === req.user.id
            ? "teacher_completed"
            : "learner_confirmed";
        if (field === "learner_confirmed" && !s.teacher_completed)
          throw fail(409, "Wait for the Student Mentor to record completion.");
        if (s[field]) throw fail(409, "You already recorded this action.");
        await c.query(
          `UPDATE exchange_sessions SET ${field}=true WHERE id=$1`,
          [s.id],
        );
        await c.query(
          "UPDATE reschedule_requests SET status='superseded',responded_at=now() WHERE exchange_session_id=$1 AND status='pending'",
          [s.id],
        );
        const remaining = Number(
          (
            await c.query(
              "SELECT count(*) FROM exchange_sessions WHERE exchange_id=$1 AND NOT (teacher_completed AND learner_confirmed)",
              [x.id],
            )
          ).rows[0].count,
        );
        if (remaining === 0)
          await c.query(
            "UPDATE exchanges SET status='completed',updated_at=now() WHERE id=$1",
            [x.id],
          );
      });
      res.json({ message: "Your session progress was recorded." });
    },
  );
  app.post("/api/exchanges/:id/reports", login, async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().trim().min(10).max(3000) })
      .parse(req.body);
    await transaction(db, async (c) => {
      const x = await participant(c, Number(req.params.id), req.user.id);
      if (!["active", "completed"].includes(x.status))
        throw fail(409, "Report an active or completed agreement.");
      await c.query(
        "INSERT INTO exchange_reports(exchange_id,reporter_id,reason) VALUES($1,$2,$3)",
        [x.id, req.user.id, reason],
      );
    });
    res
      .status(201)
      .json({
        message:
          "Unfulfilled agreement report submitted for administrator review.",
      });
  });
  app.get("/api/admin/exchanges", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT e.*,a.name requester_name,b.name recipient_name FROM exchanges e JOIN users a ON a.id=e.requester_id JOIN users b ON b.id=e.recipient_id ORDER BY e.id DESC",
        )
      ).rows,
      reports: (
        await db.query("SELECT * FROM exchange_reports ORDER BY id DESC")
      ).rows,
      sessions: (
        await db.query("SELECT * FROM exchange_sessions ORDER BY starts_at")
      ).rows,
    }),
  );
  app.post(
    "/api/admin/exchange-reports/:id/resolve",
    admin,
    async (req, res) => {
      const { reason } = z
        .object({ reason: z.string().trim().min(10).max(3000) })
        .parse(req.body);
      await transaction(db, async (c) => {
        const r = (
          await c.query(
            "UPDATE exchange_reports SET status='resolved',resolution=$1,resolved_by=$2 WHERE id=$3 AND status='open' RETURNING *",
            [reason, req.user.id, Number(req.params.id)],
          )
        ).rows[0];
        if (!r) throw fail(409, "Report missing or already resolved.");
        await c.query(
          "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
          [req.user.id, "exchange_report.resolved", String(r.id), reason],
        );
      });
      res.json({
        message: "Report resolution recorded. No money movement is involved.",
      });
    },
  );
}
