import { z } from "zod";
import { transaction } from "./db.js";
import { hashPassword, verifyPassword } from "./security.js";
import { can, permissionCatalog } from "./permissions.js";
import { loadPolicy } from "./policies.js";
import { SandboxPaymentProvider } from "./providers/sandbox.js";
import { allocationForBooking, refundAllocation } from "./payment-ledger.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const id = z.coerce.number().int().positive(),
  reason = z.string().trim().min(10).max(3000),
  short = z.string().trim().min(2).max(120),
  bodyText = z.string().trim().min(10).max(6000);
async function audit(c, actor, action, target, why) {
  await c.query(
    "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
    [actor, action, String(target), why],
  );
}
async function expire(c, userId) {
  await c.query(
    "UPDATE password_resets SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
    [userId],
  );
  await c.query("DELETE FROM session WHERE (sess->>'userId')::integer=$1", [
    userId,
  ]);
}
async function notice(c, user, title, event) {
  await c.query(
    "INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [user, title, "dashboard/commitments", event],
  );
}
export function cancellationDecision(b, a, userId) {
  if (![b.learner_id, b.mentor_id].includes(userId))
    return { allowed: false, reason: "Booking not found." };
  if (
    b.status !== "reserved" ||
    b.learning_status !== "scheduled" ||
    Date.parse(b.starts_at) <= Date.now()
  )
    return {
      allowed: false,
      reason: "Only upcoming, uncompleted reservations can be cancelled here.",
    };
  if (a && (a.status !== "held" || a.on_hold))
    return {
      allowed: false,
      reason:
        "Released, refunded or disputed allocations require administrator review.",
    };
  const noticeHours = b.cancellation_notice_hours ?? 24;
  if (
    a &&
    userId === b.learner_id &&
    (Date.parse(b.starts_at) - Date.now()) / 3600000 < noticeHours
  )
    return {
      allowed: false,
      reason: `Paid learner cancellations require at least ${noticeHours} hours notice. Contact support or open a complaint.`,
    };
  return {
    allowed: true,
    reason: a
      ? "Full remaining sandbox refund; no cancellation fee."
      : "Cancel this unpaid, free or legacy reservation without a charge.",
  };
}
export function mountAdministration(
  app,
  {
    db,
    login,
    approved,
    admin,
    commissionBps,
    completionResponseHours,
    sandboxEnabled,
  },
) {
  app.get("/api/policies", async (req, res) =>
    res.json({ policy: req.platformPolicy }),
  );
  app.get("/api/announcements", async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT id,title,body,audience,created_at FROM announcements WHERE published=true AND (audience='public' OR $1::boolean) ORDER BY id DESC LIMIT 30",
          [req.user?.role === "student"],
        )
      ).rows,
    }),
  );
  app.get("/api/account/settings", login, async (req, res) =>
    res.json({
      settings: {
        profile_public: req.user.profile_public,
        notifications: req.user.notification_preferences,
      },
    }),
  );
  app.put("/api/account/settings", login, async (req, res) => {
    const b = z
      .object({
        profile_public: z.boolean(),
        notifications: z.object({
          activity: z.boolean(),
          session_reminders: z.boolean(),
        }),
      })
      .parse(req.body);
    await db.query(
      "UPDATE users SET profile_public=$1,notification_preferences=$2 WHERE id=$3",
      [b.profile_public, JSON.stringify(b.notifications), req.user.id],
    );
    res.json({ message: "Privacy and in-app notification preferences saved." });
  });
  app.post("/api/account/password", login, async (req, res) => {
    const b = z
      .object({
        current_password: z.string().max(128),
        new_password: z.string().min(12).max(128),
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      const u = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          req.user.id,
        ])
      ).rows[0];
      if (!(await verifyPassword(b.current_password, u.password_hash)))
        throw fail(403, "Current password is incorrect.");
      if (b.current_password === b.new_password)
        throw fail(400, "Choose a different new password.");
      await c.query(
        "UPDATE users SET password_hash=$1,session_version=session_version+1 WHERE id=$2",
        [await hashPassword(b.new_password), u.id],
      );
      await expire(c, u.id);
      await audit(
        c,
        u.id,
        "account.password_changed",
        u.id,
        "Account owner changed their password.",
      );
    });
    await new Promise((ok, no) =>
      req.session.destroy((e) => (e ? no(e) : ok())),
    );
    res.clearCookie("skillswap.sid");
    res.json({
      message: "Password changed. All sessions were signed out; sign in again.",
    });
  });
  app.post("/api/account/deactivate", login, async (req, res) => {
    const b = z
      .object({ current_password: z.string().max(128), reason })
      .parse(req.body);
    if (req.user.role !== "student")
      throw fail(
        403,
        "Administrators must be managed through the protected administration controls.",
      );
    await transaction(db, async (c) => {
      const u = (
        await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          req.user.id,
        ])
      ).rows[0];
      if (!(await verifyPassword(b.current_password, u.password_hash)))
        throw fail(403, "Current password is incorrect.");
      const conflicts = Number(
        (
          await c.query(
            "SELECT (SELECT count(*) FROM bookings WHERE (learner_id=$1 OR mentor_id=$1) AND status='reserved' AND (starts_at>now() OR learning_status='completion_pending'))+(SELECT count(*) FROM exchanges WHERE (requester_id=$1 OR recipient_id=$1) AND status='active')+(SELECT count(*) FROM withdrawals WHERE mentor_id=$1 AND status='pending')+(SELECT count(*) FROM payment_allocations a JOIN bookings b ON b.id=a.booking_id WHERE (b.learner_id=$1 OR b.mentor_id=$1) AND a.status='held')+(SELECT count(*) FROM mentor_accounts WHERE user_id=$1 AND balance_minor>0) AS total",
            [u.id],
          )
        ).rows[0].total,
      );
      if (conflicts)
        throw fail(
          409,
          "Resolve active learning, held payments or available/pending earnings before deactivation.",
        );
      await c.query(
        "UPDATE users SET suspended=true,suspension_kind='deactivated',suspension_reason=$1,session_version=session_version+1 WHERE id=$2",
        [b.reason, u.id],
      );
      await expire(c, u.id);
      await audit(c, u.id, "account.deactivated", u.id, b.reason);
    });
    await new Promise((ok, no) =>
      req.session.destroy((e) => (e ? no(e) : ok())),
    );
    res.clearCookie("skillswap.sid");
    res.json({
      message:
        "Account deactivated; public profile/portfolio hidden and sessions signed out. Records are retained for history. Contact support for restoration.",
    });
  });
  app.get("/api/admin/users", admin, async (req, res) => {
    const q = z
      .object({
        q: z.string().trim().max(120).default(""),
        page: z.coerce.number().int().min(1).default(1),
        verification: z
          .enum(["unverified", "pending", "approved", "rejected"])
          .optional(),
        suspended: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query);
    const values = [`%${q.q}%`];
    let where =
      "role='student' AND (name ILIKE $1 OR email ILIKE $1 OR institution ILIKE $1)";
    if (q.verification) {
      values.push(q.verification);
      where += ` AND verification=$${values.length}`;
    }
    if (q.suspended) {
      values.push(q.suspended === "true");
      where += ` AND suspended=$${values.length}`;
    }
    const total = Number(
      (await db.query(`SELECT count(*) FROM users WHERE ${where}`, values))
        .rows[0].count,
    );
    res.json({
      total,
      page: q.page,
      pages: Math.ceil(total / 20),
      items: (
        await db.query(
          `SELECT id,name,email,institution,verification,suspended,suspension_reason,suspension_kind,created_at FROM users WHERE ${where} ORDER BY id LIMIT 20 OFFSET $${values.length + 1}`,
          [...values, (q.page - 1) * 20],
        )
      ).rows,
    });
  });
  app.post("/api/admin/users/:id/status", admin, async (req, res) => {
    const b = z.object({ suspended: z.boolean(), reason }).parse(req.body);
    await transaction(db, async (c) => {
      const u = (
        await c.query(
          "SELECT id FROM users WHERE id=$1 AND role='student' FOR UPDATE",
          [id.parse(req.params.id)],
        )
      ).rows[0];
      if (!u)
        throw fail(
          404,
          "Student account not found; administrator accounts use separate controls.",
        );
      await c.query(
        "UPDATE users SET suspended=$1,suspension_reason=$2,suspension_kind=$3,session_version=session_version+1 WHERE id=$4",
        [b.suspended, b.reason, b.suspended ? "administrative" : null, u.id],
      );
      await expire(c, u.id);
      await audit(
        c,
        req.user.id,
        b.suspended ? "student.suspended" : "student.restored",
        u.id,
        b.reason,
      );
    });
    res.json({
      message: "Student account status updated; prior sessions invalidated.",
    });
  });
  app.get("/api/admin/categories", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT c.*,count(l.id) listing_count FROM categories c LEFT JOIN listings l ON l.category_id=c.id GROUP BY c.id ORDER BY c.name",
        )
      ).rows,
    }),
  );
  app.post("/api/admin/categories", admin, async (req, res) => {
    const b = z.object({ name: short, reason }).parse(req.body);
    const result = await transaction(db, async (c) => {
      await c.query("LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE");
      if (
        (
          await c.query(
            "SELECT id FROM categories WHERE lower(name)=lower($1)",
            [b.name],
          )
        ).rows.length
      )
        throw fail(409, "A category with this name already exists.");
      const row = (
        await c.query("INSERT INTO categories(name) VALUES($1) RETURNING *", [
          b.name,
        ])
      ).rows[0];
      await audit(c, req.user.id, "category.created", row.id, b.reason);
      return row;
    });
    res.status(201).json({ category: result, message: "Category created." });
  });
  app.put("/api/admin/categories/:id", admin, async (req, res) => {
    const b = z
      .object({ name: short, active: z.boolean(), reason })
      .parse(req.body);
    await transaction(db, async (c) => {
      await c.query("LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE");
      const categoryId = id.parse(req.params.id);
      if (
        (
          await c.query(
            "SELECT id FROM categories WHERE lower(name)=lower($1) AND id<>$2",
            [b.name, categoryId],
          )
        ).rows.length
      )
        throw fail(409, "A category with this name already exists.");
      if (
        !(
          await c.query(
            "UPDATE categories SET name=$1,active=$2 WHERE id=$3 RETURNING id",
            [b.name, b.active, categoryId],
          )
        ).rows.length
      )
        throw fail(404, "Category not found.");
      await audit(
        c,
        req.user.id,
        b.active ? "category.updated" : "category.archived",
        categoryId,
        b.reason,
      );
    });
    res.json({
      message:
        "Category updated. Archived categories and their listings are hidden from new public discovery.",
    });
  });
  app.get("/api/admin/listings", admin, async (req, res) => {
    const q = z.string().trim().max(120).default("").parse(req.query.q);
    res.json({
      items: (
        await db.query(
          "SELECT l.*,u.name mentor_name,c.name category,c.active category_active FROM listings l JOIN users u ON u.id=l.mentor_id JOIN categories c ON c.id=l.category_id WHERE l.title ILIKE $1 OR u.name ILIKE $1 ORDER BY l.id DESC LIMIT 200",
          [`%${q}%`],
        )
      ).rows,
    });
  });
  app.post("/api/admin/listings/:id/moderate", admin, async (req, res) => {
    const b = z
      .object({ status: z.enum(["visible", "hidden"]), reason })
      .parse(req.body);
    await transaction(db, async (c) => {
      const l = (
        await c.query(
          "UPDATE listings SET moderation_status=$1,moderation_reason=$2,moderated_by=$3 WHERE id=$4 RETURNING id",
          [b.status, b.reason, req.user.id, id.parse(req.params.id)],
        )
      ).rows[0];
      if (!l) throw fail(404, "Listing not found.");
      await audit(c, req.user.id, `listing.${b.status}`, l.id, b.reason);
    });
    res.json({
      message:
        "Listing moderation recorded. Restoring does not override its owner status, category or mentor eligibility.",
    });
  });
  app.get("/api/admin/policies", admin, async (req, res) =>
    res.json({ policy: req.platformPolicy }),
  );
  app.put("/api/admin/policies", admin, async (req, res) => {
    const b = z
      .object({
        revision: id,
        commission_bps: z.number().int().min(0).max(10000),
        completion_response_hours: z.number().int().min(1).max(720),
        cancellation_notice_hours: z.number().int().min(0).max(168),
        registration_open: z.boolean(),
        listing_publication_open: z.boolean(),
        policy_text: z.string().trim().min(20).max(10000),
        reason,
      })
      .parse(req.body);
    const policy = await transaction(db, async (c) => {
      const row = (
        await c.query(
          "UPDATE platform_policies SET commission_bps=$1,completion_response_hours=$2,cancellation_notice_hours=$3,registration_open=$4,listing_publication_open=$5,policy_text=$6,updated_by=$7,updated_at=now(),revision=revision+1 WHERE id=1 AND revision=$8 RETURNING *",
          [
            b.commission_bps,
            b.completion_response_hours,
            b.cancellation_notice_hours,
            b.registration_open,
            b.listing_publication_open,
            b.policy_text,
            req.user.id,
            b.revision,
          ],
        )
      ).rows[0];
      if (!row)
        throw fail(
          409,
          "Policy changed. Reload the latest revision before saving.",
        );
      await audit(c, req.user.id, "policies.updated", 1, b.reason);
      return row;
    });
    res.json({
      policy,
      message:
        "Policy revision saved. Existing booking snapshots and funded commission allocations are preserved.",
    });
  });
  app.get("/api/admin/announcements", admin, async (req, res) =>
    res.json({
      items: (
        await db.query("SELECT * FROM announcements ORDER BY id DESC LIMIT 100")
      ).rows,
    }),
  );
  const announcementSchema = z.object({
    title: short,
    body: bodyText,
    audience: z.enum(["public", "students"]),
    published: z.boolean(),
    reason,
  });
  app.post("/api/admin/announcements", admin, async (req, res) => {
    const b = announcementSchema.parse(req.body);
    const row = await transaction(db, async (c) => {
      const row = (
        await c.query(
          "INSERT INTO announcements(title,body,audience,published,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [b.title, b.body, b.audience, b.published, req.user.id],
        )
      ).rows[0];
      await audit(c, req.user.id, "announcement.created", row.id, b.reason);
      return row;
    });
    res
      .status(201)
      .json({
        announcement: row,
        message:
          "Announcement saved with the selected audience and publication state.",
      });
  });
  app.put("/api/admin/announcements/:id", admin, async (req, res) => {
    const b = announcementSchema.parse(req.body);
    await transaction(db, async (c) => {
      const row = (
        await c.query(
          "UPDATE announcements SET title=$1,body=$2,audience=$3,published=$4,updated_at=now() WHERE id=$5 RETURNING id",
          [b.title, b.body, b.audience, b.published, id.parse(req.params.id)],
        )
      ).rows[0];
      if (!row) throw fail(404, "Announcement not found.");
      await audit(c, req.user.id, "announcement.updated", row.id, b.reason);
    });
    res.json({ message: "Announcement updated." });
  });
  app.get("/api/admin/roles", admin, async (req, res) =>
    res.json({
      items: (await db.query("SELECT * FROM admin_roles ORDER BY key")).rows,
      catalog: permissionCatalog,
    }),
  );
  app.post("/api/admin/roles", admin, async (req, res) => {
    const b = z
      .object({
        key: z.string().regex(/^[a-z][a-z0-9_]{2,30}$/),
        label: short,
        permissions: z
          .array(z.enum(permissionCatalog))
          .max(permissionCatalog.length),
        reason,
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      await c.query(
        "INSERT INTO admin_roles(key,label,permissions) VALUES($1,$2,$3)",
        [b.key, b.label, [...new Set(b.permissions)]],
      );
      await audit(c, req.user.id, "admin_role.created", b.key, b.reason);
    });
    res.status(201).json({ message: "Restricted administrator role created." });
  });
  app.put("/api/admin/roles/:key", admin, async (req, res) => {
    if (req.params.key === "superadmin")
      throw fail(403, "The recovery superadministrator role cannot be edited.");
    const b = z
      .object({
        label: short,
        permissions: z
          .array(z.enum(permissionCatalog))
          .max(permissionCatalog.length),
        reason,
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      if (
        !(
          await c.query(
            "UPDATE admin_roles SET label=$1,permissions=$2 WHERE key=$3 RETURNING key",
            [b.label, [...new Set(b.permissions)], req.params.key],
          )
        ).rows.length
      )
        throw fail(404, "Administrator role not found.");
      await audit(
        c,
        req.user.id,
        "admin_role.updated",
        req.params.key,
        b.reason,
      );
    });
    res.json({
      message: "Role permissions updated; changes apply on the next request.",
    });
  });
  app.get("/api/admin/administrators", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT id,name,email,admin_role,suspended,suspension_reason FROM users WHERE role='admin' ORDER BY id",
        )
      ).rows,
      roles: (await db.query("SELECT key,label FROM admin_roles ORDER BY key"))
        .rows,
    }),
  );
  app.post("/api/admin/administrators", admin, async (req, res) => {
    const b = z
      .object({
        name: short,
        email: z.email().max(254),
        password: z.string().min(12).max(128),
        admin_role: z.string().min(1).max(31),
        reason,
      })
      .parse(req.body);
    const passwordHash = await hashPassword(b.password);
    const row = await transaction(db, async (c) => {
      if (
        !(
          await c.query("SELECT key FROM admin_roles WHERE key=$1", [
            b.admin_role,
          ])
        ).rows.length
      )
        throw fail(400, "Choose an existing administrator role.");
      const u = (
        await c.query(
          "INSERT INTO users(name,email,password_hash,institution,role,admin_role) VALUES($1,$2,$3,'Platform administration','admin',$4) RETURNING id,name,email,admin_role",
          [b.name, b.email.toLowerCase(), passwordHash, b.admin_role],
        )
      ).rows[0];
      await audit(c, req.user.id, "administrator.created", u.id, b.reason);
      return u;
    });
    res
      .status(201)
      .json({
        administrator: row,
        message: "Separate administrator account created. No email was sent.",
      });
  });
  app.put("/api/admin/administrators/:id", admin, async (req, res) => {
    const target = id.parse(req.params.id);
    if (target === req.user.id)
      throw fail(
        403,
        "You cannot suspend or change your own administrator role.",
      );
    const b = z
      .object({
        admin_role: z.string().min(1).max(31),
        suspended: z.boolean(),
        reason,
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      await c.query(
        "SELECT id FROM users WHERE role='admin' ORDER BY id FOR UPDATE",
      );
      const u = (
        await c.query("SELECT * FROM users WHERE id=$1 AND role='admin'", [
          target,
        ])
      ).rows[0];
      if (!u) throw fail(404, "Administrator not found.");
      if (
        !(
          await c.query("SELECT key FROM admin_roles WHERE key=$1", [
            b.admin_role,
          ])
        ).rows.length
      )
        throw fail(400, "Choose an existing administrator role.");
      if (
        u.admin_role === "superadmin" &&
        !u.suspended &&
        (b.suspended || b.admin_role !== "superadmin")
      ) {
        const total = Number(
          (
            await c.query(
              "SELECT count(*) FROM users WHERE role='admin' AND admin_role='superadmin' AND suspended=false",
            )
          ).rows[0].count,
        );
        if (total <= 1)
          throw fail(409, "Keep at least one active superadministrator.");
      }
      await c.query(
        "UPDATE users SET admin_role=$1,suspended=$2,suspension_reason=$3,session_version=session_version+1 WHERE id=$4",
        [b.admin_role, b.suspended, b.reason, u.id],
      );
      await expire(c, u.id);
      await audit(c, req.user.id, "administrator.updated", u.id, b.reason);
    });
    res.json({
      message: "Administrator access updated; old sessions invalidated.",
    });
  });
  app.get("/api/admin/reports", admin, async (req, res) => {
    const row = (
      await db.query(
        "SELECT (SELECT count(*) FROM users WHERE role='student') students,(SELECT count(*) FROM users WHERE role='student' AND suspended=true) suspended_students,(SELECT count(*) FROM listings WHERE status='published' AND moderation_status='visible') published_listings,(SELECT count(*) FROM bookings WHERE status='reserved') reserved_bookings,(SELECT count(*) FROM bookings WHERE learning_status='completed' AND status='reserved') completed_bookings,(SELECT count(*) FROM exchanges WHERE status='active') active_exchanges,(SELECT count(*) FROM payment_disputes WHERE status<>'resolved') open_payment_disputes,(SELECT count(*) FROM support_tickets WHERE status<>'resolved') open_support_tickets",
      )
    ).rows[0];
    res.json({
      metrics: Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, Number(v)]),
      ),
      bookings_by_month: (
        await db.query(
          `SELECT to_char(date_trunc('month',created_at),'YYYY-MM') AS "month",count(*) total FROM bookings GROUP BY date_trunc('month',created_at) ORDER BY "month" DESC LIMIT 12`,
        )
      ).rows,
      sandbox_only: true,
    });
  });
  app.get("/api/support/tickets", login, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY id DESC",
          [req.user.id],
        )
      ).rows,
    }),
  );
  app.post("/api/support/tickets", login, async (req, res) => {
    const b = z.object({ subject: short, body: bodyText }).parse(req.body);
    const row = (
      await db.query(
        "INSERT INTO support_tickets(user_id,subject,body) VALUES($1,$2,$3) RETURNING *",
        [req.user.id, b.subject, b.body],
      )
    ).rows[0];
    res
      .status(201)
      .json({
        ticket: row,
        message: "Support request stored for platform review.",
      });
  });
  app.get("/api/support/tickets/:id", login, async (req, res) => {
    const t = (
      await db.query("SELECT * FROM support_tickets WHERE id=$1", [
        id.parse(req.params.id),
      ])
    ).rows[0];
    if (!t || (t.user_id !== req.user.id && !can(req.user, "support.read")))
      throw fail(404, "Support request not found.");
    res.json({
      ticket: t,
      replies: (
        await db.query(
          "SELECT r.*,u.name FROM support_replies r JOIN users u ON u.id=r.author_id WHERE ticket_id=$1 ORDER BY r.id",
          [t.id],
        )
      ).rows,
    });
  });
  app.post("/api/support/tickets/:id/replies", login, async (req, res) => {
    const b = z.object({ body: bodyText }).parse(req.body);
    await transaction(db, async (c) => {
      const t = (
        await c.query("SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE", [
          id.parse(req.params.id),
        ])
      ).rows[0];
      if (!t || (t.user_id !== req.user.id && !can(req.user, "support.write")))
        throw fail(404, "Support request not found.");
      if (t.status === "resolved")
        throw fail(
          409,
          "This support request is resolved. Open a new request if needed.",
        );
      await c.query(
        "INSERT INTO support_replies(ticket_id,author_id,body) VALUES($1,$2,$3)",
        [t.id, req.user.id, b.body],
      );
      await c.query("UPDATE support_tickets SET updated_at=now() WHERE id=$1", [
        t.id,
      ]);
    });
    res.status(201).json({ message: "Support reply recorded." });
  });
  app.get("/api/admin/complaints", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT t.*,u.name,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 200",
        )
      ).rows,
      administrators: (
        await db.query(
          "SELECT u.id,u.name FROM users u JOIN admin_roles r ON r.key=u.admin_role WHERE u.role='admin' AND u.suspended=false AND (r.permissions @> ARRAY['*'] OR r.permissions @> ARRAY['support.write']) ORDER BY u.id",
        )
      ).rows,
    }),
  );
  app.post("/api/admin/complaints/:id/status", admin, async (req, res) => {
    const b = z
      .object({
        status: z.enum(["open", "in_progress", "resolved"]),
        assigned_to: id.nullable(),
        reason,
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      if (b.assigned_to) {
        const candidate = (
          await c.query(
            "SELECT u.id FROM users u JOIN admin_roles r ON r.key=u.admin_role WHERE u.id=$1 AND u.role='admin' AND u.suspended=false AND (r.permissions @> ARRAY['*'] OR r.permissions @> ARRAY['support.write'])",
            [b.assigned_to],
          )
        ).rows[0];
        if (!candidate)
          throw fail(400, "Choose an active support administrator.");
      }
      const t = (
        await c.query(
          "UPDATE support_tickets SET status=$1,assigned_to=$2,resolution_reason=$3,updated_at=now() WHERE id=$4 RETURNING *",
          [b.status, b.assigned_to, b.reason, id.parse(req.params.id)],
        )
      ).rows[0];
      if (!t) throw fail(404, "Support request not found.");
      await audit(c, req.user.id, `support.${b.status}`, t.id, b.reason);
    });
    res.json({
      message: "Support status, assignment and recorded reason updated.",
    });
  });
  app.post("/api/admin/exchanges/:id/terminate", admin, async (req, res) => {
    const b = z.object({ reason }).parse(req.body);
    await transaction(db, async (c) => {
      const x = (
        await c.query("SELECT * FROM exchanges WHERE id=$1 FOR UPDATE", [
          id.parse(req.params.id),
        ])
      ).rows[0];
      if (!x) throw fail(404, "Exchange not found.");
      if (!["pending", "negotiating", "active"].includes(x.status))
        throw fail(
          409,
          "Only an outstanding exchange can be terminated after review.",
        );
      await c.query(
        "UPDATE exchanges SET status='cancelled',updated_at=now() WHERE id=$1",
        [x.id],
      );
      await c.query(
        "UPDATE exchange_cancellations SET status='cancelled',responder_id=$1,responded_at=now() WHERE exchange_id=$2 AND status='pending'",
        [req.user.id, x.id],
      );
      await c.query(
        "UPDATE reschedule_requests SET status='superseded',responded_at=now() WHERE exchange_session_id IN (SELECT id FROM exchange_sessions WHERE exchange_id=$1) AND status='pending'",
        [x.id],
      );
      await c.query(
        "UPDATE exchange_reports SET status='resolved',resolution=$1,resolved_by=$2 WHERE exchange_id=$3 AND status='open'",
        [b.reason, req.user.id, x.id],
      );
      await audit(c, req.user.id, "exchange.admin_terminated", x.id, b.reason);
      for (const person of [x.requester_id, x.recipient_id])
        await notice(
          c,
          person,
          "Administrator cancelled an exchange after review.",
          `exchange:${x.id}:terminated`,
        );
    });
    res.json({
      message:
        "Exchange terminated after review. Session/completion history retained; no money moved.",
    });
  });
  app.get("/api/account/commitments", login, async (req, res) => {
    const b = (
      await db.query(
        "SELECT b.*,l.title FROM bookings b JOIN listings l ON l.id=b.listing_id WHERE b.learner_id=$1 OR b.mentor_id=$1 ORDER BY b.starts_at DESC",
        [req.user.id],
      )
    ).rows;
    const a = (
      await db.query(
        "SELECT a.* FROM payment_allocations a JOIN bookings b ON b.id=a.booking_id WHERE b.learner_id=$1 OR b.mentor_id=$1",
        [req.user.id],
      )
    ).rows;
    res.json({
      bookings: b.map((b) => ({
        ...b,
        cancellation: cancellationDecision(
          b,
          a.find((a) => a.booking_id === b.id),
          req.user.id,
        ),
      })),
      exchanges: (
        await db.query(
          "SELECT * FROM exchanges WHERE (requester_id=$1 OR recipient_id=$1) AND status='active' ORDER BY id DESC",
          [req.user.id],
        )
      ).rows,
      exchange_cancellations: (
        await db.query(
          "SELECT c.* FROM exchange_cancellations c JOIN exchanges x ON x.id=c.exchange_id WHERE x.requester_id=$1 OR x.recipient_id=$1 ORDER BY c.id DESC",
          [req.user.id],
        )
      ).rows,
    });
  });
  app.post("/api/bookings/:id/cancel", login, async (req, res) => {
    const b = z.object({ reason, idempotency_key: z.uuid() }).parse(req.body);
    const row = await transaction(db, async (c) => {
      const bookingId = id.parse(req.params.id);
      const booking = (
        await c.query("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [
          bookingId,
        ])
      ).rows[0];
      if (
        !booking ||
        ![booking.learner_id, booking.mentor_id].includes(req.user.id)
      )
        throw fail(404, "Booking not found.");
      const prior = (
        await c.query(
          "SELECT * FROM booking_cancellations WHERE booking_id=$1",
          [bookingId],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.actor_id === req.user.id &&
          prior.idempotency_key === b.idempotency_key &&
          prior.reason === b.reason
        )
          return prior;
        throw fail(409, "This booking has already been cancelled.");
      }
      const allocation = await allocationForBooking(c, bookingId);
      const decision = cancellationDecision(booking, allocation, req.user.id);
      if (!decision.allowed) throw fail(409, decision.reason);
      let refund = null;
      if (allocation) {
        if (!sandboxEnabled)
          throw fail(
            503,
            "Sandbox refunds are currently disabled; contact administrator support.",
          );
        refund = await refundAllocation(c, allocation, {
          amount: allocation.gross_minor - allocation.refunded_minor,
          reason: b.reason,
          actorId: req.user.id,
          operationKey: `booking:${booking.id}:cancel`,
          provider: new SandboxPaymentProvider(),
        });
      }
      await c.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [
        bookingId,
      ]);
      await c.query(
        "UPDATE reschedule_requests SET status='superseded',responded_at=now() WHERE booking_id=$1 AND status='pending'",
        [bookingId],
      );
      const row = (
        await c.query(
          "INSERT INTO booking_cancellations(booking_id,actor_id,idempotency_key,reason,refund_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [
            bookingId,
            req.user.id,
            b.idempotency_key,
            b.reason,
            refund?.id || null,
          ],
        )
      ).rows[0];
      await audit(c, req.user.id, "booking.cancelled", bookingId, b.reason);
      await notice(
        c,
        booking.learner_id === req.user.id
          ? booking.mentor_id
          : booking.learner_id,
        "A session reservation was cancelled.",
        `booking:${bookingId}:cancel`,
      );
      return row;
    });
    res.json({
      cancellation: row,
      message:
        "Reservation cancelled. Any eligible remaining sandbox payment was fully refunded; no real money moved.",
    });
  });
  app.post("/api/exchanges/:id/cancellation", login, async (req, res) => {
    const b = z.object({ reason }).parse(req.body);
    const row = await transaction(db, async (c) => {
      const x = (
        await c.query("SELECT * FROM exchanges WHERE id=$1 FOR UPDATE", [
          id.parse(req.params.id),
        ])
      ).rows[0];
      if (!x || ![x.requester_id, x.recipient_id].includes(req.user.id))
        throw fail(404, "Exchange not found.");
      if (x.status !== "active")
        throw fail(409, "Mutual cancellation is for active agreements only.");
      const row = (
        await c.query(
          "INSERT INTO exchange_cancellations(exchange_id,proposer_id,reason) VALUES($1,$2,$3) RETURNING *",
          [x.id, req.user.id, b.reason],
        )
      ).rows[0];
      await notice(
        c,
        x.requester_id === req.user.id ? x.recipient_id : x.requester_id,
        "An exchange cancellation needs your response.",
        `exchange-cancel:${row.id}`,
      );
      return row;
    });
    res
      .status(201)
      .json({
        request: row,
        message:
          "Mutual cancellation proposed. The active schedule remains in force until the partner accepts.",
      });
  });
  app.post(
    "/api/exchange-cancellations/:id/respond",
    login,
    async (req, res) => {
      const b = z
        .object({ action: z.enum(["accept", "reject", "cancel"]) })
        .parse(req.body);
      await transaction(db, async (c) => {
        const initial = (
          await c.query(
            "SELECT exchange_id FROM exchange_cancellations WHERE id=$1",
            [id.parse(req.params.id)],
          )
        ).rows[0];
        if (!initial) throw fail(404, "Cancellation request not found.");
        const x = (
          await c.query("SELECT * FROM exchanges WHERE id=$1 FOR UPDATE", [
            initial.exchange_id,
          ])
        ).rows[0];
        if (![x.requester_id, x.recipient_id].includes(req.user.id))
          throw fail(404, "Cancellation request not found.");
        const r = (
          await c.query(
            "SELECT * FROM exchange_cancellations WHERE id=$1 FOR UPDATE",
            [id.parse(req.params.id)],
          )
        ).rows[0];
        if (r.status !== "pending" || x.status !== "active")
          throw fail(409, "The request or agreement is no longer active.");
        if ((b.action === "cancel") !== (r.proposer_id === req.user.id))
          throw fail(
            403,
            "Only the proposer may withdraw; only the partner may accept/reject.",
          );
        const status =
          b.action === "accept"
            ? "accepted"
            : b.action === "reject"
              ? "rejected"
              : "cancelled";
        await c.query(
          "UPDATE exchange_cancellations SET status=$1,responder_id=$2,responded_at=now() WHERE id=$3",
          [status, req.user.id, r.id],
        );
        if (status === "accepted") {
          await c.query(
            "UPDATE exchanges SET status='cancelled',updated_at=now() WHERE id=$1",
            [x.id],
          );
          await c.query(
            "UPDATE reschedule_requests SET status='superseded',responded_at=now() WHERE exchange_session_id IN (SELECT id FROM exchange_sessions WHERE exchange_id=$1) AND status='pending'",
            [x.id],
          );
        }
        await audit(
          c,
          req.user.id,
          `exchange_cancellation.${status}`,
          x.id,
          r.reason,
        );
        await notice(
          c,
          x.requester_id === req.user.id ? x.recipient_id : x.requester_id,
          `Exchange cancellation ${status}.`,
          `exchange-cancel:${r.id}:${status}`,
        );
      });
      res.json({
        message:
          "Mutual exchange cancellation response recorded; completion history retained.",
      });
    },
  );
}
