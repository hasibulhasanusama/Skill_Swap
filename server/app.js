import { assistantChat } from "./assistant-chat.js";
import { mountArena } from "./arena.js";
import { fileURLToPath } from "node:url";
import { mountAdministration } from "./administration.js";
import { loadPolicy } from "./policies.js";
import {
  loadPermissions,
  can,
  adminPermissionFor,
  adminFileAccess,
} from "./permissions.js";
import {
  mountProjects,
  publicPortfolio,
  publicReviews,
  profileStatistics,
} from "./projects.js";
import { mountPayments } from "./payments.js";
import { mountLearning } from "./learning.js";
import { createLocalStorage, documentType, safeFilename } from "./storage.js";
import { mountExchanges } from "./exchanges.js";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  hashPassword,
  verifyPassword,
  tokenHash,
  publicUser,
} from "./security.js";
import { transaction } from "./db.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = z.string().trim().min(2).max(300);
const listingSchema = z.object({
  category_id: z.coerce.number().int().positive(),
  title: text.max(100),
  description: text.max(5000),
  level: z.enum(["Beginner", "Intermediate", "Advanced"]),
  objectives: text.max(2000),
  prerequisites: z.string().max(1000).default(""),
  duration_minutes: z.coerce.number().int().min(15).max(180),
  fee_minor: z.coerce.number().int().min(0).max(10000000),
  exchange_enabled: z.boolean().default(true),
  status: z.enum(["draft", "published", "inactive"]).default("draft"),
});
export function createApp({
  db,
  store,
  storageDir = process.env.STORAGE_DIR || "./storage/private",
  secret = process.env.SESSION_SECRET,
  storageAdapter,
  arenaServices,
  completionResponseHours = Number(process.env.COMPLETION_RESPONSE_HOURS || 72),
  commissionBps = Number(process.env.COMMISSION_BPS || 1000),
  webhookSecret = process.env.SANDBOX_WEBHOOK_SECRET || secret,
  sandboxEnabled = process.env.NODE_ENV !== "production" ||
    process.env.SANDBOX_ENABLED === "true",
}) {
  const app = express();
  const storage = path.resolve(storageDir);
  const fileStorage = storageAdapter || createLocalStorage(storage);
  const production = process.env.NODE_ENV === "production";
  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (req, res) => {
    try {
      const r = await db.query("SELECT id FROM platform_policies WHERE id=1");
      if (!r.rows.length) throw new Error("Missing policy");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  if (
    !Number.isInteger(completionResponseHours) ||
    completionResponseHours < 1 ||
    completionResponseHours > 720
  )
    throw new Error(
      "COMPLETION_RESPONSE_HOURS must be an integer between 1 and 720.",
    );
  if (production) app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    express.json({
      limit: "64kb",
      verify: (req, res, buf) => {
        if (req.originalUrl.split("?")[0] === "/api/payments/sandbox/webhook")
          req.rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(
    session({
      name: "skillswap.sid",
      secret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        maxAge: 86400000,
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 200,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const authLimit = rateLimit({
    windowMs: 900000,
    limit: 30,
    legacyHeaders: false,
  });
  app.use("/api", async (req, res, next) => {
    try {
      if (req.session.userId) {
        req.user = (
          await db.query("SELECT * FROM users WHERE id=$1", [
            req.session.userId,
          ])
        ).rows[0];
        if (
          !req.user ||
          req.user.suspended ||
          (req.session.authVersion ?? 1) !== req.user.session_version
        ) {
          req.session.destroy(() => {});
          throw fail(401, "Account unavailable or session expired.");
        }
        await loadPermissions(db, req.user);
      }
      req.platformPolicy = await loadPolicy(db, {
        commissionBps,
        completionResponseHours,
      });
      next();
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (req, res, next) => {
    if (
      req.path !== "/payments/sandbox/webhook" &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.session.csrf || req.get("X-CSRF-Token") !== req.session.csrf)
    )
      return next(fail(403, "Refresh the page and retry: invalid CSRF token."));
    next();
  });
  app.use("/api/admin", (req, res, next) => {
    const permission = adminPermissionFor(req.path, req.method);
    if (!permission || !can(req.user, permission))
      return next(
        fail(
          403,
          "Administrator permission required: " +
            (permission || "recognized operation"),
        ),
      );
    next();
  });
  const login = (req, res, next) =>
    req.user ? next() : next(fail(401, "Please sign in."));
  const skillAssistantLimit = rateLimit({
    windowMs: 60000,
    limit: 10,
    message: { error: "এক মিনিট পরে আবার চেষ্টা করুন।" },
  });
  app.post("/api/skill-assistant/chat", login, skillAssistantLimit, assistantChat);
  const approved = (req, res, next) =>
    !req.user
      ? next(fail(401, "Please sign in."))
      : req.user.role !== "student" || req.user.verification !== "approved"
        ? next(fail(403, "Approved student verification is required."))
        : next();
  const admin = (req, res, next) =>
    req.user?.role === "admin"
      ? next()
      : next(fail(403, "Administrator access required."));
  app.get("/api/auth/me", (req, res) => {
    req.session.csrf ??= randomBytes(24).toString("hex");
    res.json({ user: publicUser(req.user) || null, csrf: req.session.csrf });
  });
  app.post("/api/auth/register", authLimit, async (req, res) => {
    if (!req.platformPolicy.registration_open)
      throw fail(403, "New student registration is temporarily paused.");
    const b = z
      .object({
        name: text,
        institution: text,
        email: z.email().max(254),
        password: z.string().min(12).max(128),
        enrolled: z.literal(true),
      })
      .parse(req.body);
    const hash = await hashPassword(b.password);
    const u = await db.query(
      "INSERT INTO users(email,password_hash,name,institution) VALUES($1,$2,$3,$4) RETURNING *",
      [b.email.toLowerCase(), hash, b.name, b.institution],
    );
    res
      .status(201)
      .json({
        user: publicUser(u.rows[0]),
        message: "Account created. Sign in to submit your student ID.",
      });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const b = z
      .object({ email: z.email(), password: z.string().max(128) })
      .parse(req.body);
    const u = (
      await db.query("SELECT * FROM users WHERE email=$1", [
        b.email.toLowerCase(),
      ])
    ).rows[0];
    if (
      !u ||
      !(await verifyPassword(b.password, u.password_hash)) ||
      u.suspended
    )
      throw fail(401, "Invalid credentials or suspended account.");
    await new Promise((ok, no) =>
      req.session.regenerate((e) => (e ? no(e) : ok())),
    );
    req.session.userId = u.id;
    req.session.authVersion = u.session_version;
    await loadPermissions(db, u);
    req.session.csrf = randomBytes(24).toString("hex");
    res.json({ user: publicUser(u), csrf: req.session.csrf });
  });
  app.post("/api/auth/logout", login, async (req, res) => {
    await new Promise((ok, no) =>
      req.session.destroy((e) => (e ? no(e) : ok())),
    );
    res.clearCookie("skillswap.sid");
    res.json({ message: "Signed out." });
  });
  app.post("/api/auth/recover", authLimit, async (req, res) => {
    const { email } = z.object({ email: z.email() }).parse(req.body);
    const u = (
      await db.query("SELECT id FROM users WHERE email=$1", [
        email.toLowerCase(),
      ])
    ).rows[0];
    if (u) {
      const token = randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
        [u.id, tokenHash(token)],
      );
      if (!production) {
        await mkdir(storage, { recursive: true });
        await writeFile(
          path.join(storage, `outbox-${randomUUID()}.json`),
          JSON.stringify({
            to: email,
            reset_url: `${process.env.APP_ORIGIN || "http://localhost:3000"}/#reset?token=${token}`,
          }),
          { mode: 0o600 },
        );
      } else throw fail(503, "Email provider is not configured.");
    }
    res.json({
      message:
        "If the account exists, recovery instructions were placed in the development email outbox.",
    });
  });
  app.post("/api/auth/reset", authLimit, async (req, res) => {
    const b = z
      .object({
        token: z.string().length(64),
        password: z.string().min(12).max(128),
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      const initial = (
        await c.query(
          "SELECT user_id FROM password_resets WHERE token_hash=$1",
          [tokenHash(b.token)],
        )
      ).rows[0];
      if (!initial) throw fail(400, "Reset link is invalid or expired.");
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        initial.user_id,
      ]);
      const r = (
        await c.query(
          "SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
          [tokenHash(b.token)],
        )
      ).rows[0];
      if (!r) throw fail(400, "Reset link is invalid or expired.");
      await c.query(
        "UPDATE users SET password_hash=$1,session_version=session_version+1 WHERE id=$2",
        [await hashPassword(b.password), r.user_id],
      );
      await c.query(
        "UPDATE password_resets SET used_at=now() WHERE user_id=$1",
        [r.user_id],
      );
      await c.query("DELETE FROM session WHERE (sess->>'userId')::integer=$1", [
        r.user_id,
      ]);
    });
    res.json({ message: "Password changed. Sign in again." });
  });

  app.put("/api/profile", login, async (req, res) => {
    const b = z.object({
      name: text,
      institution: text,
      bio: z.string().max(2000),
      phone: z.string().trim().max(25)
        .regex(/^[+0-9() -]*$/, "Enter a valid phone number.")
        .optional(),
      age: z.preprocess(
        value => value === "" || value == null ? null : Number(value),
        z.number().int().min(1).max(120).nullable()
      ),
      gender: z.enum(["", "male", "female"]).optional(),
      email: z.email().max(254).optional()
    }).parse(req.body);

    const email = b.email?.trim().toLowerCase();

    if (email) {
      const existing = await db.query(
        "SELECT id FROM users WHERE lower(email)=$1 AND id<>$2",
        [email, req.user.id]
      );
      if (existing.rows.length) {
        throw fail(409, "This email is already used by another account.");
      }
    }

    let u;
    try {
      u = (await db.query(
        "UPDATE users SET name=$1,institution=$2,bio=$3,phone=COALESCE($4,phone),age=$5,gender=COALESCE($6,gender),email=COALESCE($7,email) WHERE id=$8 RETURNING *",
        [
          b.name, b.institution, b.bio, b.phone ?? null,
          b.age, b.gender ?? null, email ?? null, req.user.id
        ]
      )).rows[0];
    } catch (error) {
      if (error.code === "23505") {
        throw fail(409, "This email is already in use.");
      }
      throw error;
    }

    res.json({ user: publicUser(u) });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });

  // Current account profile picture
  app.get("/api/profile/avatar", login, async (req, res) => {
    const u = (await db.query(
      "SELECT avatar_key,avatar_mime FROM users WHERE id=$1",
      [req.user.id]
    )).rows[0];

    if (!u?.avatar_key) throw fail(404, "No profile picture.");
    const bytes = await fileStorage.read(u.avatar_key);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.type(u.avatar_mime).send(bytes);
  });

  app.post(
    "/api/profile/avatar",
    login,
    upload.single("avatar"),
    async (req, res) => {
      if (!req.file) throw fail(400, "Choose a PNG or JPEG picture.");

      const mime = documentType(req.file.buffer);
      if (!["image/png", "image/jpeg"].includes(mime)) {
        throw fail(400, "Only PNG and JPEG pictures are supported.");
      }

      const key = await fileStorage.put(req.file.buffer);
      let result;

      try {
        result = await transaction(db, async (c) => {
          const previous = (await c.query(
            "SELECT avatar_key FROM users WHERE id=$1 FOR UPDATE",
            [req.user.id]
          )).rows[0];

          const updated = (await c.query(
            "UPDATE users SET avatar_key=$1,avatar_mime=$2,avatar_updated_at=now() WHERE id=$3 RETURNING *",
            [key, mime, req.user.id]
          )).rows[0];

          return { previous: previous.avatar_key, updated };
        });
      } catch (error) {
        await fileStorage.delete(key).catch(() => {});
        throw error;
      }

      if (result.previous) {
        await fileStorage.delete(result.previous).catch(() => {});
      }

      res.json({
        user: publicUser(result.updated),
        message: "Profile picture updated."
      });
    }
  );

  app.delete("/api/profile/avatar", login, async (req, res) => {
    const result = await transaction(db, async (c) => {
      const previous = (await c.query(
        "SELECT avatar_key FROM users WHERE id=$1 FOR UPDATE",
        [req.user.id]
      )).rows[0];

      const updated = (await c.query(
        "UPDATE users SET avatar_key=NULL,avatar_mime=NULL,avatar_updated_at=now() WHERE id=$1 RETURNING *",
        [req.user.id]
      )).rows[0];

      return { previous: previous.avatar_key, updated };
    });

    if (result.previous) {
      await fileStorage.delete(result.previous).catch(() => {});
    }

    res.json({
      user: publicUser(result.updated),
      message: "Profile picture removed."
    });
  });


  app.post(
    "/api/verification",
    login,
    upload.single("document"),
    async (req, res) => {
      if (req.user.role !== "student") {
        throw fail(403, "Student verification is for student accounts.");
      }

      // Automatic competition demo approval
      const studentId = String(req.body.student_id || "").trim();
      if (!/^\d{3}-\d{2}-\d{3}$/.test(studentId)) {
        throw fail(400, "Enter a Student ID like 242-35-350.");
      }

      const f = req.file;
      if (!f) throw fail(400, "Choose a PDF, PNG, or JPEG student ID.");

      const type = documentType(f.buffer);
      if (!type) throw fail(400, "Unsupported document content.");

      const key = await fileStorage.put(f.buffer);

      try {
        await transaction(db, async (c) => {
          await c.query(
            "SELECT id FROM users WHERE id=$1 FOR UPDATE",
            [req.user.id]
          );

          const file = (await c.query(
            "INSERT INTO files(owner_id,storage_key,original_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5) RETURNING id",
            [req.user.id, key, safeFilename(f.originalname), type, f.size]
          )).rows[0];

          const pending = (await c.query(
            "SELECT id FROM verifications WHERE user_id=$1 AND status='pending' FOR UPDATE",
            [req.user.id]
          )).rows[0];

          if (pending) {
            await c.query(
              "UPDATE verifications SET file_id=$1,student_id=$2,status='approved',reason=$3,reviewer_id=NULL,reviewed_at=now() WHERE id=$4",
              [file.id, studentId, "Demo approval: ID format and document submission only. Identity not authenticated.", pending.id]
            );
          } else {
            await c.query(
              "INSERT INTO verifications(user_id,file_id,student_id,status,reason,reviewed_at) VALUES($1,$2,$3,'approved',$4,now())",
              [req.user.id, file.id, studentId, "Demo approval: ID format and document submission only. Identity not authenticated."]
            );
          }

          await c.query(
            "UPDATE users SET verification='approved',student_id=$2 WHERE id=$1",
            [req.user.id, studentId]
          );
        });
      } catch (error) {
        await fileStorage.delete(key).catch(() => {});
        throw error;
      }

      res.status(201).json({
        message: "Demo approved. Student ID format and document submission accepted; identity is not authenticated."
      });
    }
  );

  app.get("/api/verification", login, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT id,status,reason,created_at FROM verifications WHERE user_id=$1 ORDER BY id DESC",
          [req.user.id],
        )
      ).rows,
    }),
  );
  app.get("/api/files/:id", login, async (req, res) => {
    const f = (
      await db.query("SELECT * FROM files WHERE id=$1", [Number(req.params.id)])
    ).rows[0];
    if (!f) throw fail(404, "File not found.");
    if (
      f.owner_id !== req.user.id &&
      !(await adminFileAccess(db, req.user, f.id))
    ) {
      const shared = await db.query(
        "SELECT m.id FROM learning_materials m LEFT JOIN bookings b ON b.id=m.booking_id LEFT JOIN exchanges e ON e.id=m.exchange_id WHERE m.file_id=$1 AND (b.learner_id=$2 OR b.mentor_id=$2 OR e.requester_id=$2 OR e.recipient_id=$2)",
        [f.id, req.user.id],
      );
      if (!shared.rows.length) {
        const evidence = await db.query(
          "SELECT e.id FROM dispute_evidence e JOIN payment_disputes d ON d.id=e.dispute_id JOIN bookings b ON b.id=d.booking_id WHERE e.file_id=$1 AND (b.learner_id=$2 OR b.mentor_id=$2)",
          [f.id, req.user.id],
        );
        if (!evidence.rows.length) {
          const work = await db.query(
            "SELECT s.id FROM project_submissions s JOIN project_tasks t ON t.id=s.task_id WHERE s.file_id=$1 AND (t.learner_id=$2 OR t.mentor_id=$2)",
            [f.id, req.user.id],
          );
          if (!work.rows.length) throw fail(404, "File not found.");
        }
      }
    }
    res.type(f.mime_type).attachment(safeFilename(f.original_name));
    res.send(await fileStorage.read(f.storage_key));
  });
  app.get("/api/categories", async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT * FROM categories WHERE active=true ORDER BY name",
        )
      ).rows,
    }),
  );
  app.get("/api/listings", async (req, res) => {
    const q = z
      .object({
        q: z.string().max(100).default(""),
        category: z.coerce.number().int().optional(),
        level: z.enum(["Beginner", "Intermediate", "Advanced"]).optional(),
        max_price: z.coerce.number().int().min(0).optional(),
        available: z.enum(["true", "false"]).optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    let where =
      "l.status='published' AND l.moderation_status='visible' AND EXISTS(SELECT 1 FROM categories c0 WHERE c0.id=l.category_id AND c0.active=true) AND u.suspended=false AND u.verification='approved'";
    const p = [];
    const add = (sql, v) => {
      p.push(v);
      where += ` AND ${sql.replace("?", `$${p.length}`)}`;
    };
    if (q.q)
      (add("(l.title ILIKE ? OR l.description ILIKE ?)", `%${q.q}%`),
        (where = where.replace(/\?(?=\))/, `$${p.length}`)));
    if (q.category) add("l.category_id=?", q.category);
    if (q.level) add("l.level=?", q.level);
    if (q.max_price !== undefined) add("l.fee_minor<=?", q.max_price);
    if (q.available === "true")
      where += ` AND EXISTS(SELECT 1 FROM availability a WHERE a.listing_id=l.id AND a.starts_at>now() AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=a.id AND b.status='reserved'))`;
    const total = Number(
      (
        await db.query(
          `SELECT count(*) FROM listings l JOIN users u ON u.id=l.mentor_id WHERE ${where}`,
          p,
        )
      ).rows[0].count,
    );
    const items = (
      await db.query(
        `SELECT l.*,u.name mentor_name,u.profile_public mentor_profile_public,u.institution,c.name category FROM listings l JOIN users u ON u.id=l.mentor_id JOIN categories c ON c.id=l.category_id WHERE ${where} ORDER BY l.id LIMIT 9 OFFSET $${p.length + 1}`,
        [...p, (q.page - 1) * 9],
      )
    ).rows;
    res.json({ items, total, page: q.page, pages: Math.ceil(total / 9) });
  });
  app.get("/api/listings/:id", async (req, res) => {
    const l = (
      await db.query(
        "SELECT l.*,u.name mentor_name,u.profile_public mentor_profile_public,u.institution,CASE WHEN u.profile_public THEN u.bio ELSE '' END bio,c.name category FROM listings l JOIN users u ON u.id=l.mentor_id JOIN categories c ON c.id=l.category_id WHERE l.id=$1 AND l.status='published' AND l.moderation_status='visible' AND EXISTS(SELECT 1 FROM categories c0 WHERE c0.id=l.category_id AND c0.active=true) AND u.suspended=false AND u.verification='approved'",
        [Number(req.params.id)],
      )
    ).rows[0];
    if (!l) throw fail(404, "Skill not found.");
    const slots = (
      await db.query(
        `SELECT a.* FROM availability a WHERE listing_id=$1 AND starts_at>now() AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=a.id AND b.status='reserved') ORDER BY starts_at`,
        [l.id],
      )
    ).rows;
    res.json({ listing: l, slots });
  });
  app.get("/api/mentors/:id", async (req, res) => {
    const u = (
      await db.query(
        "SELECT id,name,institution,bio FROM users WHERE id=$1 AND verification='approved' AND suspended=false AND profile_public=true AND role='student'",
        [Number(req.params.id)],
      )
    ).rows[0];
    if (!u) throw fail(404, "Mentor not found.");
    res.json({
      mentor: u,
      listings: (
        await db.query(
          "SELECT * FROM listings WHERE mentor_id=$1 AND status='published' AND moderation_status='visible' AND EXISTS(SELECT 1 FROM categories c WHERE c.id=listings.category_id AND c.active=true)",
          [u.id],
        )
      ).rows,
      portfolio: await publicPortfolio(db, u.id),
      reviews: await publicReviews(db, u.id),
      statistics: await profileStatistics(db, u.id),
    });
  });
  app.post("/api/listings", approved, async (req, res) => {
    const b = listingSchema.parse(req.body);
    if (
      b.status === "published" &&
      !req.platformPolicy.listing_publication_open
    )
      throw fail(
        403,
        "Publishing new or updated listings is temporarily paused.",
      );
    if (
      !(
        await db.query(
          "SELECT id FROM categories WHERE id=$1 AND active=true",
          [b.category_id],
        )
      ).rows.length
    )
      throw fail(400, "Choose an active category.");
    const l = (
      await db.query(
        "INSERT INTO listings(mentor_id,category_id,title,description,level,objectives,prerequisites,duration_minutes,fee_minor,exchange_enabled,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [req.user.id, ...Object.values(b)],
      )
    ).rows[0];
    res.status(201).json({ listing: l });
  });
  app.put("/api/listings/:id", approved, async (req, res) => {
    const b = listingSchema.parse(req.body);
    if (
      b.status === "published" &&
      !req.platformPolicy.listing_publication_open
    )
      throw fail(
        403,
        "Publishing new or updated listings is temporarily paused.",
      );
    if (
      !(
        await db.query(
          "SELECT id FROM categories WHERE id=$1 AND active=true",
          [b.category_id],
        )
      ).rows.length
    )
      throw fail(400, "Choose an active category.");
    const l = (
      await db.query(
        "UPDATE listings SET category_id=$1,title=$2,description=$3,level=$4,objectives=$5,prerequisites=$6,duration_minutes=$7,fee_minor=$8,exchange_enabled=$9,status=$10 WHERE id=$11 AND mentor_id=$12 RETURNING *",
        [...Object.values(b), Number(req.params.id), req.user.id],
      )
    ).rows[0];
    if (!l) throw fail(404, "Listing not found or not owned by you.");
    res.json({ listing: l });
  });
  app.post("/api/listings/:id/slots", approved, async (req, res) => {
    const b = z
      .object({ starts_at: z.iso.datetime({ offset: true }) })
      .parse(req.body);
    const l = (
      await db.query("SELECT * FROM listings WHERE id=$1 AND mentor_id=$2", [
        Number(req.params.id),
        req.user.id,
      ])
    ).rows[0];
    if (!l) throw fail(404, "Listing not found.");
    if (Date.parse(b.starts_at) <= Date.now())
      throw fail(400, "Choose a future start time.");
    const end = new Date(
      Date.parse(b.starts_at) + l.duration_minutes * 60000,
    ).toISOString();
    const slot = (
      await db.query(
        "INSERT INTO availability(listing_id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING *",
        [l.id, b.starts_at, end],
      )
    ).rows[0];
    res.status(201).json({ slot });
  });
  app.post("/api/bookings", approved, async (req, res) => {
    const { slot_id } = z
      .object({ slot_id: z.coerce.number().int().positive() })
      .parse(req.body);
    const booking = await transaction(db, async (c) => {
      const slot = (
        await c.query(
          "SELECT a.*,l.mentor_id,l.fee_minor FROM availability a JOIN listings l ON l.id=a.listing_id JOIN users u ON u.id=l.mentor_id WHERE a.id=$1 AND a.starts_at>now() AND l.status='published' AND l.moderation_status='visible' AND EXISTS(SELECT 1 FROM categories c0 WHERE c0.id=l.category_id AND c0.active=true) AND u.suspended=false AND u.verification='approved'",
          [slot_id],
        )
      ).rows[0];
      if (!slot) throw fail(404, "Slot unavailable.");
      if (slot.mentor_id === req.user.id)
        throw fail(400, "You cannot book your own listing.");
      await c.query(
        "SELECT id FROM users WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",
        [req.user.id, slot.mentor_id],
      );
      const eligible = (
        await c.query(
          "SELECT id FROM users WHERE id IN ($1,$2) AND suspended=false AND verification='approved' AND role='student'",
          [req.user.id, slot.mentor_id],
        )
      ).rows;
      if (eligible.length !== 2)
        throw fail(409, "Both students must remain active and verified.");
      const conflict = (
        await c.query(
          "SELECT id FROM bookings WHERE status='reserved' AND (learner_id IN ($1,$2) OR mentor_id IN ($1,$2)) AND starts_at<$4 AND ends_at>$3",
          [req.user.id, slot.mentor_id, slot.starts_at, slot.ends_at],
        )
      ).rows;
      if (conflict.length)
        throw fail(
          409,
          "A participant already has a booking during this time.",
        );
      const exchangeConflict = await c.query(
        "SELECT s.id FROM exchange_sessions s JOIN exchanges e ON e.id=s.exchange_id WHERE e.status='active' AND (e.requester_id IN ($1,$2) OR e.recipient_id IN ($1,$2)) AND s.starts_at<$4 AND s.ends_at>$3",
        [req.user.id, slot.mentor_id, slot.starts_at, slot.ends_at],
      );
      if (exchangeConflict.rows.length)
        throw fail(
          409,
          "A participant already has an exchange session during this time.",
        );
      return (
        await c.query(
          "INSERT INTO bookings(learner_id,mentor_id,listing_id,slot_id,starts_at,ends_at,amount_minor,payment_required,cancellation_notice_hours,completion_response_hours) VALUES($1,$2,$3,$4,$5,$6,$7,($7>0),$8,$9) RETURNING *",
          [
            req.user.id,
            slot.mentor_id,
            slot.listing_id,
            slot.id,
            slot.starts_at,
            slot.ends_at,
            slot.fee_minor,
            req.platformPolicy.cancellation_notice_hours,
            req.platformPolicy.completion_response_hours,
          ],
        )
      ).rows[0];
    });
    res
      .status(201)
      .json({
        booking,
        message:
          "Slot reserved. Paid sessions require sandbox checkout; no real money is collected.",
      });
  });
  app.get("/api/dashboard", login, async (req, res) => {
    const id = req.user.id;
    res.json({
      listings: (
        await db.query(
          "SELECT * FROM listings WHERE mentor_id=$1 ORDER BY id DESC",
          [id],
        )
      ).rows,
      bookings: (
        await db.query(
          "SELECT b.*,l.title,m.name mentor_name,u.name learner_name FROM bookings b JOIN listings l ON l.id=b.listing_id JOIN users m ON m.id=b.mentor_id JOIN users u ON u.id=b.learner_id WHERE b.learner_id=$1 OR b.mentor_id=$1 ORDER BY b.starts_at",
          [id],
        )
      ).rows,
      verification:
        (
          await db.query(
            "SELECT id,status,reason FROM verifications WHERE user_id=$1 ORDER BY id DESC LIMIT 1",
            [id],
          )
        ).rows[0] || null,
      exchanges: (
        await db.query(
          "SELECT e.*,a.name requester_name,b.name recipient_name FROM exchanges e JOIN users a ON a.id=e.requester_id JOIN users b ON b.id=e.recipient_id WHERE e.requester_id=$1 OR e.recipient_id=$1 ORDER BY e.id DESC",
          [id],
        )
      ).rows,
      exchange_sessions: (
        await db.query(
          "SELECT s.*,e.requester_id,e.recipient_id,a.name requester_name,b.name recipient_name FROM exchange_sessions s JOIN exchanges e ON e.id=s.exchange_id JOIN users a ON a.id=e.requester_id JOIN users b ON b.id=e.recipient_id WHERE (e.requester_id=$1 OR e.recipient_id=$1) AND e.status IN ('active','completed') ORDER BY s.starts_at",
          [id],
        )
      ).rows,
    });
  });
  app.get("/api/admin/overview", admin, async (req, res) =>
    res.json({
      students: Number(
        (await db.query("SELECT count(*) FROM users WHERE role='student'"))
          .rows[0].count,
      ),
      pending: Number(
        (
          await db.query(
            "SELECT count(*) FROM verifications WHERE status='pending'",
          )
        ).rows[0].count,
      ),
      listings: Number(
        (await db.query("SELECT count(*) FROM listings")).rows[0].count,
      ),
      bookings: Number(
        (await db.query("SELECT count(*) FROM bookings")).rows[0].count,
      ),
    }),
  );
  app.get("/api/admin/verifications", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT v.*,u.name,u.email,u.institution FROM verifications v JOIN users u ON u.id=v.user_id ORDER BY v.id DESC",
        )
      ).rows,
    }),
  );
  app.post("/api/admin/verifications/:id", admin, async (req, res) => {
    const b = z
      .object({
        status: z.enum(["approved", "rejected"]),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    await transaction(db, async (c) => {
      const v = (
        await c.query(
          "UPDATE verifications SET status=$1,reason=$2,reviewer_id=$3,reviewed_at=now() WHERE id=$4 AND status='pending' RETURNING *",
          [b.status, b.reason, req.user.id, Number(req.params.id)],
        )
      ).rows[0];
      if (!v) throw fail(409, "Verification already reviewed or missing.");
      await c.query("UPDATE users SET verification=$1 WHERE id=$2", [
        b.status,
        v.user_id,
      ]);
      await c.query(
        "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
        [req.user.id, `verification.${b.status}`, String(v.id), b.reason],
      );
    });
    res.json({ message: "Verification decision recorded." });
  });
  app.get("/api/admin/audit", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT a.*,u.name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100",
        )
      ).rows,
    }),
  );
  mountArena(app, { db, login, upload, storage: fileStorage, services: arenaServices });
  mountExchanges(app, { db, login, approved, admin });
  mountLearning(app, {
    db,
    login,
    approved,
    admin,
    upload,
    storage: fileStorage,
    completionResponseHours,
  });
  mountPayments(app, {
    db,
    login,
    approved,
    admin,
    upload,
    storage: fileStorage,
    commissionBps,
    webhookSecret,
    sandboxEnabled,
  });
  mountProjects(app, {
    db,
    login,
    approved,
    admin,
    upload,
    storage: fileStorage,
  });
  mountAdministration(app, {
    db,
    login,
    approved,
    admin,
    commissionBps,
    completionResponseHours,
    sandboxEnabled,
  });
  app.use(
    express.static(fileURLToPath(new URL("../public/", import.meta.url))),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({
          error: err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
    if (err.code === "23505" && err.constraint === "one_open_payment_dispute")
      return res
        .status(409)
        .json({
          error: "There is already an open dispute for this allocation.",
        });
    if (err.code === "23505")
      return res
        .status(409)
        .json({
          error:
            err.constraint === "one_active_exchange_pair"
              ? "You already have a pending or active exchange with this student."
              : err.constraint === "one_open_exchange_report"
                ? "Your existing report is still awaiting review."
                : [
                      "one_pending_booking_reschedule",
                      "one_pending_exchange_reschedule",
                    ].includes(err.constraint)
                  ? "There is already a pending reschedule for this session."
                  : "This record already exists or the slot is already reserved.",
        });
    if (err.code === "23503")
      return res.status(400).json({ error: "Related record was not found." });
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(400).json({ error: "File must be at most 5 MB." });
    if (!err.status) console.error(err);
    res
      .status(err.status || 500)
      .json({ error: err.status ? err.message : "Unexpected server error." });
  });
  return app;
}
