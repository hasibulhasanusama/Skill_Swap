import {
  requireFundedBooking,
  releaseForConfirmedBooking,
} from "./payment-ledger.js";
import { z } from "zod";
import { transaction } from "./db.js";
import { assertNoConflict } from "./scheduling.js";
import { documentType, safeFilename } from "./storage.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const idSchema = z.coerce.number().int().positive();
const contextParams = z.object({
  kind: z.enum(["booking", "exchange"]),
  id: idSchema,
});
const sessionParams = z.object({
  kind: z.enum(["booking", "exchange-session"]),
  id: idSchema,
});
const fieldFor = (kind) => (kind === "booking" ? "booking_id" : "exchange_id");
const sessionField = (kind) =>
  kind === "booking" ? "booking_id" : "exchange_session_id";
const routeFor = (kind, id) =>
  `dashboard/room/${kind === "booking" ? "booking" : "exchange"}/${id}`;
async function notify(c, userId, title, route, event) {
  await c.query(
    "INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [userId, title, route, event],
  );
}
export async function learningContext(c, kind, id, userId, lock = false) {
  const x = (
    await c.query(
      kind === "booking"
        ? `SELECT * FROM bookings WHERE id=$1${lock ? " FOR UPDATE" : ""}`
        : `SELECT * FROM exchanges WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!x) throw fail(404, "Learning room not found.");
  const participants =
    kind === "booking"
      ? [x.learner_id, x.mentor_id]
      : [x.requester_id, x.recipient_id];
  if (!participants.includes(userId))
    throw fail(404, "Learning room not found.");
  const writable =
    kind === "booking"
      ? x.status === "reserved" && x.learning_status !== "completed"
      : ["pending", "negotiating", "active"].includes(x.status);
  return { record: x, participants, writable };
}
async function sessionContext(c, kind, id, userId, lock = false) {
  if (kind === "booking") {
    const ctx = await learningContext(c, "booking", id, userId, lock);
    return {
      ...ctx,
      session: ctx.record,
      parentKind: "booking",
      parentId: id,
      teacherId: ctx.record.mentor_id,
    };
  }
  // Parent always locks before child, matching exchange agreement/completion lock order.
  const row = (
    await c.query("SELECT exchange_id FROM exchange_sessions WHERE id=$1", [id])
  ).rows[0];
  if (!row) throw fail(404, "Session not found.");
  const ctx = await learningContext(
    c,
    "exchange",
    row.exchange_id,
    userId,
    lock,
  );
  const s = (
    await c.query(
      `SELECT * FROM exchange_sessions WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!s) throw fail(404, "Session not found.");
  return {
    ...ctx,
    writable:
      ctx.record.status === "active" &&
      !s.teacher_completed &&
      !s.learner_confirmed,
    session: s,
    parentKind: "exchange",
    parentId: row.exchange_id,
    teacherId: s.teacher_id,
  };
}
const sessionOpen = (ctx) =>
  ctx.writable &&
  (ctx.parentKind !== "booking" || ctx.session.learning_status === "scheduled");
function validMeeting(value) {
  if (value === "") return true;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      value.length <= 2000
    );
  } catch {
    return false;
  }
}
export function mountLearning(
  app,
  { db, login, approved, admin, upload, storage, completionResponseHours = 72 },
) {
  app.get("/api/learning/contexts", login, async (req, res) => {
    const b = (
      await db.query(
        "SELECT b.id,b.status,b.learning_status,l.title,u.name counterpart FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users u ON u.id=CASE WHEN b.learner_id=$1 THEN b.mentor_id ELSE b.learner_id END WHERE b.learner_id=$1 OR b.mentor_id=$1 ORDER BY b.id DESC",
        [req.user.id],
      )
    ).rows;
    const x = (
      await db.query(
        "SELECT e.id,e.status,e.requester_skill,e.recipient_skill,u.name counterpart FROM exchanges e JOIN users u ON u.id=CASE WHEN e.requester_id=$1 THEN e.recipient_id ELSE e.requester_id END WHERE e.requester_id=$1 OR e.recipient_id=$1 ORDER BY e.id DESC",
        [req.user.id],
      )
    ).rows;
    const unread = (
      await db.query(
        "SELECT m.booking_id,m.exchange_id,count(*) FROM learning_messages m LEFT JOIN bookings b ON b.id=m.booking_id LEFT JOIN exchanges e ON e.id=m.exchange_id WHERE (b.learner_id=$1 OR b.mentor_id=$1 OR e.requester_id=$1 OR e.recipient_id=$1) AND m.sender_id<>$1 AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message_id=m.id AND r.user_id=$1) GROUP BY m.booking_id,m.exchange_id",
        [req.user.id],
      )
    ).rows;
    const items = [
      ...b.map((r) => ({ ...r, kind: "booking" })),
      ...x.map((r) => ({
        ...r,
        kind: "exchange",
        title: `${r.requester_skill} ↔ ${r.recipient_skill}`,
      })),
    ].map((r) => ({
      ...r,
      unread: Number(
        unread.find((u) => u[fieldFor(r.kind)] === r.id)?.count || 0,
      ),
    }));
    res.json({ items });
  });
  app.get("/api/learning/:kind/:id", login, async (req, res) => {
    const { kind, id } = contextParams.parse(req.params);
    const ctx = await learningContext(db, kind, id, req.user.id);
    const column = fieldFor(kind);
    const sessions =
      kind === "booking"
        ? [
            {
              ...ctx.record,
              teacher_id: ctx.record.mentor_id,
              session_kind: "booking",
            },
          ]
        : (
            await db.query(
              "SELECT *,'exchange-session' AS session_kind FROM exchange_sessions WHERE exchange_id=$1 ORDER BY starts_at",
              [id],
            )
          ).rows;
    const materials = (
      await db.query(
        `SELECT m.*,f.original_name,f.size_bytes,u.name uploader_name FROM learning_materials m JOIN files f ON f.id=m.file_id JOIN users u ON u.id=m.uploader_id WHERE m.${column}=$1 ORDER BY m.id DESC`,
        [id],
      )
    ).rows;
    const people = (
      await db.query(
        "SELECT id,name FROM users WHERE id IN ($1,$2)",
        ctx.participants,
      )
    ).rows;
    const reschedules = (
      await db.query(
        kind === "booking"
          ? "SELECT * FROM reschedule_requests WHERE booking_id=$1 ORDER BY id DESC"
          : "SELECT r.* FROM reschedule_requests r JOIN exchange_sessions s ON s.id=r.exchange_session_id WHERE s.exchange_id=$1 ORDER BY r.id DESC",
        [id],
      )
    ).rows;
    const attendance = (
      await db.query(
        kind === "booking"
          ? "SELECT * FROM attendance_records WHERE booking_id=$1"
          : "SELECT a.* FROM attendance_records a JOIN exchange_sessions s ON s.id=a.exchange_session_id WHERE s.exchange_id=$1",
        [id],
      )
    ).rows;
    res.json({
      kind,
      id,
      allocation:
        kind === "booking"
          ? (
              await db.query(
                "SELECT * FROM payment_allocations WHERE booking_id=$1",
                [id],
              )
            ).rows[0] || null
          : null,
      record: ctx.record,
      participants: people,
      writable: ctx.writable,
      sessions,
      materials,
      reschedules,
      attendance,
      timezone: "Asia/Dhaka",
    });
  });
  app.get("/api/learning/:kind/:id/messages", login, async (req, res) => {
    const { kind, id } = contextParams.parse(req.params);
    await learningContext(db, kind, id, req.user.id);
    const before = z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .parse(req.query.before);
    const items = (
      await db.query(
        `SELECT m.*,u.name sender_name FROM learning_messages m JOIN users u ON u.id=m.sender_id WHERE m.${fieldFor(kind)}=$1 AND m.id<$2 ORDER BY m.id DESC LIMIT 101`,
        [id, before || 2147483647],
      )
    ).rows;
    const more = items.length > 100;
    res.json({ items: items.slice(0, 100).reverse(), has_more: more });
  });
  app.post("/api/learning/:kind/:id/messages", login, async (req, res) => {
    const { kind, id } = contextParams.parse(req.params);
    const b = z
      .object({
        body: z.string().trim().min(1).max(4000),
        client_key: z.uuid(),
      })
      .parse(req.body);
    const message = await transaction(db, async (c) => {
      const ctx = await learningContext(c, kind, id, req.user.id, true);
      const existing = (
        await c.query(
          "SELECT * FROM learning_messages WHERE sender_id=$1 AND client_key=$2",
          [req.user.id, b.client_key],
        )
      ).rows[0];
      if (existing) {
        if (existing[fieldFor(kind)] !== id || existing.body !== b.body)
          throw fail(
            409,
            "This message key was already used for different content.",
          );
        return existing;
      }
      if (!ctx.writable) throw fail(409, "This learning room is read-only.");
      return (
        await c.query(
          `INSERT INTO learning_messages(${fieldFor(kind)},sender_id,body,client_key) VALUES($1,$2,$3,$4) RETURNING *`,
          [id, req.user.id, b.body, b.client_key],
        )
      ).rows[0];
    });
    res.status(201).json({ message });
  });
  app.post("/api/learning/:kind/:id/read", login, async (req, res) => {
    const { kind, id } = contextParams.parse(req.params);
    await learningContext(db, kind, id, req.user.id);
    const { through_id } = z.object({ through_id: idSchema }).parse(req.body);
    await db.query(
      `INSERT INTO message_reads(user_id,message_id) SELECT $1,m.id FROM learning_messages m WHERE m.${fieldFor(kind)}=$2 AND m.id<=$3 AND m.sender_id<>$1 ON CONFLICT DO NOTHING`,
      [req.user.id, id, through_id],
    );
    res.json({ message: "Conversation marked as read." });
  });
  app.post(
    "/api/learning/:kind/:id/materials",
    approved,
    upload.single("material"),
    async (req, res) => {
      const { kind, id } = contextParams.parse(req.params);
      const { title } = z
        .object({ title: z.string().trim().min(2).max(120) })
        .parse(req.body);
      const f = req.file;
      if (!f) throw fail(400, "Choose a learning material.");
      let type = documentType(f.buffer);
      if (
        !type &&
        /\.(txt|md)$/i.test(f.originalname) &&
        !f.buffer.includes(0)
      ) {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(f.buffer);
          type = "text/plain";
        } catch {}
      }
      if (!type)
        throw fail(
          400,
          "Use a PDF, PNG, JPEG or UTF-8 TXT/MD file, up to 5 MB.",
        );
      let key;
      try {
        const material = await transaction(db, async (c) => {
          const ctx = await learningContext(c, kind, id, req.user.id, true);
          if (
            !ctx.writable ||
            (kind === "exchange" && ctx.record.status !== "active")
          )
            throw fail(
              409,
              "Materials can be shared in active learning rooms.",
            );
          key = await storage.put(f.buffer);
          const file = (
            await c.query(
              "INSERT INTO files(owner_id,storage_key,original_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5) RETURNING id",
              [req.user.id, key, safeFilename(f.originalname), type, f.size],
            )
          ).rows[0];
          const material = (
            await c.query(
              `INSERT INTO learning_materials(${fieldFor(kind)},uploader_id,file_id,title) VALUES($1,$2,$3,$4) RETURNING *`,
              [id, req.user.id, file.id, title],
            )
          ).rows[0];
          await notify(
            c,
            ctx.participants.find((p) => p !== req.user.id),
            "A new learning material was shared.",
            routeFor(kind, id),
            `material:${material.id}`,
          );
          return material;
        });
        res
          .status(201)
          .json({
            material,
            message: "Private material shared with your learning partner.",
          });
      } catch (e) {
        if (key) await storage.delete(key);
        throw e;
      }
    },
  );
  app.put(
    "/api/learning-sessions/:kind/:id/meeting",
    approved,
    async (req, res) => {
      const { kind, id } = sessionParams.parse(req.params);
      const { meeting_url } = z
        .object({
          meeting_url: z
            .string()
            .refine(
              validMeeting,
              "Use an HTTPS meeting link without embedded credentials, or leave it blank.",
            ),
        })
        .parse(req.body);
      await transaction(db, async (c) => {
        const ctx = await sessionContext(c, kind, id, req.user.id, true);
        if (req.user.id !== ctx.teacherId)
          throw fail(
            403,
            "Only the Student Mentor can update the meeting link.",
          );
        if (!ctx.writable)
          throw fail(409, "This session is no longer editable.");
        await c.query(
          `UPDATE ${kind === "booking" ? "bookings" : "exchange_sessions"} SET meeting_url=$1 WHERE id=$2`,
          [meeting_url, id],
        );
      });
      res.json({
        message:
          "External meeting link saved. Opening it does not record attendance.",
      });
    },
  );
  app.post(
    "/api/learning-sessions/:kind/:id/attendance",
    login,
    async (req, res) => {
      const { kind, id } = sessionParams.parse(req.params);
      const b = z
        .object({
          status: z.enum(["present", "absent"]),
          note: z.string().trim().max(500).default(""),
        })
        .parse(req.body);
      await transaction(db, async (c) => {
        const ctx = await sessionContext(c, kind, id, req.user.id, true);
        if (Date.parse(ctx.session.starts_at) > Date.now())
          throw fail(409, "Record your attendance after the session starts.");
        if (
          ctx.record.status === "cancelled" ||
          (ctx.parentKind === "exchange" &&
            !["active", "completed"].includes(ctx.record.status))
        )
          throw fail(409, "Attendance is unavailable for this session.");
        const col = sessionField(kind);
        await c.query(
          `INSERT INTO attendance_records(${col},user_id,status,note) VALUES($1,$2,$3,$4) ON CONFLICT(${col},user_id) DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,updated_at=now()`,
          [id, req.user.id, b.status, b.note],
        );
      });
      res.json({ message: "Your self-reported attendance was saved." });
    },
  );
  app.post(
    "/api/learning-sessions/:kind/:id/reschedules",
    approved,
    async (req, res) => {
      const { kind, id } = sessionParams.parse(req.params);
      const b = z
        .object({
          starts_at: z.iso.datetime({ offset: true }),
          reason: z.string().trim().min(5).max(1000),
        })
        .parse(req.body);
      const r = await transaction(db, async (c) => {
        const ctx = await sessionContext(c, kind, id, req.user.id, true);
        if (
          !sessionOpen(ctx) ||
          Date.parse(ctx.session.starts_at) <= Date.now()
        )
          throw fail(
            409,
            "Only upcoming, uncompleted sessions can be rescheduled.",
          );
        if (
          Date.parse(b.starts_at) <= Date.now() ||
          Date.parse(b.starts_at) === Date.parse(ctx.session.starts_at)
        )
          throw fail(400, "Choose a different future time.");
        const ends = new Date(
          Date.parse(b.starts_at) +
            Date.parse(ctx.session.ends_at) -
            Date.parse(ctx.session.starts_at),
        ).toISOString();
        await assertNoConflict(c, {
          participants: ctx.participants,
          starts_at: b.starts_at,
          ends_at: ends,
          ignoreBooking: kind === "booking" ? id : 0,
          ignoreExchangeSession: kind === "exchange-session" ? id : 0,
        });
        const r = (
          await c.query(
            `INSERT INTO reschedule_requests(${sessionField(kind)},proposer_id,original_starts_at,proposed_starts_at,proposed_ends_at,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [
              id,
              req.user.id,
              ctx.session.starts_at,
              b.starts_at,
              ends,
              b.reason,
            ],
          )
        ).rows[0];
        await notify(
          c,
          ctx.participants.find((p) => p !== req.user.id),
          "A session reschedule needs your response.",
          routeFor(ctx.parentKind, ctx.parentId),
          `reschedule:${r.id}:proposed`,
        );
        return r;
      });
      res
        .status(201)
        .json({
          reschedule: r,
          message:
            "Proposal sent. The original time remains reserved until your partner accepts.",
        });
    },
  );
  app.post("/api/reschedules/:id/respond", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { action } = z
      .object({ action: z.enum(["accept", "reject", "cancel"]) })
      .parse(req.body);
    await transaction(db, async (c) => {
      const initial = (
        await c.query("SELECT * FROM reschedule_requests WHERE id=$1", [id])
      ).rows[0];
      if (!initial) throw fail(404, "Proposal not found.");
      const kind = initial.booking_id ? "booking" : "exchange-session",
        sessionId = initial.booking_id || initial.exchange_session_id;
      const ctx = await sessionContext(c, kind, sessionId, req.user.id, true);
      const r = (
        await c.query(
          "SELECT * FROM reschedule_requests WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (r.status !== "pending")
        throw fail(409, "This proposal has already been handled.");
      if ((action === "cancel") !== (r.proposer_id === req.user.id))
        throw fail(
          403,
          "The proposer may cancel; only the other participant may accept or reject.",
        );
      let status =
        action === "accept"
          ? "accepted"
          : action === "reject"
            ? "rejected"
            : "cancelled";
      if (action === "accept") {
        if (
          !sessionOpen(ctx) ||
          Date.parse(ctx.session.starts_at) !==
            Date.parse(r.original_starts_at) ||
          Date.parse(ctx.session.starts_at) <= Date.now() ||
          Date.parse(r.proposed_starts_at) <= Date.now()
        )
          throw fail(409, "The schedule changed or is no longer upcoming.");
        const eligible = (
          await c.query(
            "SELECT id FROM users WHERE id IN ($1,$2) AND verification='approved' AND suspended=false",
            ctx.participants,
          )
        ).rows;
        if (eligible.length !== 2)
          throw fail(
            409,
            "Both participants must be active verified students.",
          );
        await assertNoConflict(c, {
          participants: ctx.participants,
          starts_at: r.proposed_starts_at,
          ends_at: r.proposed_ends_at,
          ignoreBooking: kind === "booking" ? sessionId : 0,
          ignoreExchangeSession: kind === "exchange-session" ? sessionId : 0,
        });
        await c.query(
          `UPDATE ${kind === "booking" ? "bookings" : "exchange_sessions"} SET starts_at=$1,ends_at=$2 WHERE id=$3`,
          [r.proposed_starts_at, r.proposed_ends_at, sessionId],
        );
        if (kind === "exchange-session")
          await c.query(
            "UPDATE exchanges SET revision=revision+1,updated_at=now() WHERE id=$1",
            [ctx.parentId],
          );
      }
      await c.query(
        "UPDATE reschedule_requests SET status=$1,responder_id=$2,responded_at=now() WHERE id=$3",
        [status, req.user.id, id],
      );
      await notify(
        c,
        ctx.participants.find((p) => p !== req.user.id),
        `Session reschedule ${status}.`,
        routeFor(ctx.parentKind, ctx.parentId),
        `reschedule:${id}:${status}`,
      );
      await c.query(
        "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
        [req.user.id, `reschedule.${status}`, String(id), r.reason],
      );
    });
    res.json({ message: "Reschedule response recorded." });
  });
  app.post("/api/bookings/:id/complete", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await transaction(db, async (c) => {
      const ctx = await sessionContext(c, "booking", id, req.user.id, true),
        b = ctx.session;
      if (b.status !== "reserved" || b.learning_status !== "scheduled")
        throw fail(409, "This booking is not awaiting mentor completion.");
      if (req.user.id !== b.mentor_id)
        throw fail(403, "Only the Student Mentor can record delivery.");
      if (Date.parse(b.ends_at) > Date.now())
        throw fail(409, "Record completion after the session ends.");
      await requireFundedBooking(c, b);
      await c.query(
        "UPDATE bookings SET learning_status='completion_pending',mentor_completed_at=now(),confirmation_due_at=now()+($1 * interval '1 hour') WHERE id=$2",
        [
          b.completion_response_hours ??
            req.platformPolicy.completion_response_hours ??
            completionResponseHours,
          id,
        ],
      );
      await c.query(
        "UPDATE reschedule_requests SET status='superseded',responded_at=now() WHERE booking_id=$1 AND status='pending'",
        [id],
      );
      await notify(
        c,
        b.learner_id,
        "Confirm whether your session was delivered.",
        routeFor("booking", id),
        `booking:${id}:completion`,
      );
    });
    res.json({
      message:
        "Delivery recorded. Learner confirmation is required; no payment is released.",
    });
  });
  app.post("/api/bookings/:id/confirm", approved, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await transaction(db, async (c) => {
      const { session: b } = await sessionContext(
        c,
        "booking",
        id,
        req.user.id,
        true,
      );
      if (req.user.id !== b.learner_id)
        throw fail(403, "Only the learner can confirm.");
      if (b.status !== "reserved" || b.learning_status !== "completion_pending")
        throw fail(409, "The Student Mentor must record delivery first.");
      await c.query(
        "UPDATE bookings SET learning_status='completed',learner_confirmed_at=now() WHERE id=$1",
        [id],
      );
      const confirmed = (
        await c.query("SELECT * FROM bookings WHERE id=$1", [id])
      ).rows[0];
      await releaseForConfirmedBooking(c, confirmed, req.user.id);
      await notify(
        c,
        b.mentor_id,
        "Your learner confirmed the session.",
        routeFor("booking", id),
        `booking:${id}:confirmed`,
      );
    });
    res.json({
      message:
        "Session delivery confirmed. Eligible sandbox earnings released; no real funds moved.",
    });
  });
  app.get("/api/notifications", login, async (req, res) => {
    const items = (
      await db.query(
        "SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 100",
        [req.user.id],
      )
    ).rows;
    const upcomingBookings = (
      await db.query(
        "SELECT id,starts_at FROM bookings WHERE (learner_id=$1 OR mentor_id=$1) AND status='reserved' AND learning_status='scheduled' AND starts_at>now() AND starts_at<=now()+interval '24 hours' ORDER BY starts_at",
        [req.user.id],
      )
    ).rows;
    const upcomingExchanges = (
      await db.query(
        "SELECT s.id,s.exchange_id,s.starts_at FROM exchange_sessions s JOIN exchanges e ON e.id=s.exchange_id WHERE (e.requester_id=$1 OR e.recipient_id=$1) AND e.status='active' AND s.starts_at>now() AND s.starts_at<=now()+interval '24 hours' ORDER BY s.starts_at",
        [req.user.id],
      )
    ).rows;
    res.json({
      items: req.user.notification_preferences.activity ? items : [],
      unread: req.user.notification_preferences.activity
        ? Number(
            (
              await db.query(
                "SELECT count(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL",
                [req.user.id],
              )
            ).rows[0].count,
          )
        : 0,
      upcoming: req.user.notification_preferences.session_reminders
        ? [
            ...upcomingBookings.map((s) => ({
              ...s,
              kind: "booking",
              route: routeFor("booking", s.id),
            })),
            ...upcomingExchanges.map((s) => ({
              ...s,
              kind: "exchange-session",
              route: routeFor("exchange", s.exchange_id),
            })),
          ].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        : [],
    });
  });
  app.post("/api/notifications/:id/read", login, async (req, res) => {
    const result = await db.query(
      "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id",
      [idSchema.parse(req.params.id), req.user.id],
    );
    if (!result.rows.length) throw fail(404, "Notification not found.");
    res.json({ message: "Notification marked as read." });
  });
  app.get("/api/admin/learning-sessions", admin, async (req, res) =>
    res.json({
      bookings: (
        await db.query(
          "SELECT b.*,l.title FROM bookings b JOIN listings l ON l.id=b.listing_id ORDER BY b.id DESC LIMIT 100",
        )
      ).rows,
      attendance: (
        await db.query(
          "SELECT * FROM attendance_records ORDER BY updated_at DESC LIMIT 200",
        )
      ).rows,
      reschedules: (
        await db.query(
          "SELECT * FROM reschedule_requests ORDER BY id DESC LIMIT 100",
        )
      ).rows,
    }),
  );
}
