import { can } from "./permissions.js";
import { z } from "zod";
import { transaction } from "./db.js";
import { SandboxPaymentProvider, validWebhook } from "./providers/sandbox.js";
import {
  feeSplit,
  lockWallet,
  walletEntry,
  allocationForBooking,
  applyProviderEvent,
  refundAllocation,
  releaseAllocation,
} from "./payment-ledger.js";
import { documentType, safeFilename } from "./storage.js";
const fail = (status, message) => Object.assign(new Error(message), { status });
const id = z.coerce.number().int().positive(),
  reason = z.string().trim().min(10).max(3000),
  key = z.uuid();
async function audit(c, actor, action, target, why) {
  await c.query(
    "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
    [actor, action, String(target), why],
  );
}
async function notify(c, user, title, event) {
  await c.query(
    "INSERT INTO notifications(user_id,title,route,event_key) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [user, title, "dashboard/payments", event],
  );
}
async function booking(c, bookingId, userId, lock = true) {
  const b = (
    await c.query(
      `SELECT * FROM bookings WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [bookingId],
    )
  ).rows[0];
  if (!b || ![b.learner_id, b.mentor_id].includes(userId))
    throw fail(404, "Booking not found.");
  return b;
}
async function adminAllocation(c, allocationId) {
  const row = (
    await c.query("SELECT booking_id FROM payment_allocations WHERE id=$1", [
      allocationId,
    ])
  ).rows[0];
  if (!row) throw fail(404, "Allocation not found.");
  await c.query("SELECT id FROM bookings WHERE id=$1 FOR UPDATE", [
    row.booking_id,
  ]);
  return (
    await c.query("SELECT * FROM payment_allocations WHERE id=$1 FOR UPDATE", [
      allocationId,
    ])
  ).rows[0];
}
async function dispute(c, disputeId, user, lock = false) {
  if (user.role === "admin" && !can(user, "disputes.read"))
    throw fail(403, "Payment dispute review permission required.");
  const initial = (
    await c.query("SELECT booking_id FROM payment_disputes WHERE id=$1", [
      disputeId,
    ])
  ).rows[0];
  if (!initial) throw fail(404, "Dispute not found.");
  const b = (
    await c.query(
      `SELECT * FROM bookings WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [initial.booking_id],
    )
  ).rows[0];
  if (user.role !== "admin" && ![b.learner_id, b.mentor_id].includes(user.id))
    throw fail(404, "Dispute not found.");
  const d = (
    await c.query(
      `SELECT * FROM payment_disputes WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
      [disputeId],
    )
  ).rows[0];
  return { d, b };
}
export function mountPayments(
  app,
  {
    db,
    login,
    approved,
    admin,
    upload,
    storage,
    webhookSecret,
    commissionBps = 1000,
    sandboxEnabled = true,
    provider = new SandboxPaymentProvider(),
  },
) {
  if (
    process.env.PAYMENT_PROVIDER &&
    process.env.PAYMENT_PROVIDER !== "sandbox"
  )
    throw new Error("Only PAYMENT_PROVIDER=sandbox is implemented.");
  if (typeof webhookSecret !== "string" || webhookSecret.length < 32)
    throw new Error("Use a webhook signing secret of at least 32 characters.");
  if (
    !Number.isInteger(commissionBps) ||
    commissionBps < 0 ||
    commissionBps > 10000
  )
    throw new Error("COMMISSION_BPS must be an integer 0–10000.");
  if (provider.name !== "sandbox" || provider.supportsRealFundHolding !== false)
    throw new Error("This release supports the sandbox provider only.");
  const enabled = (req, res, next) =>
    sandboxEnabled
      ? next()
      : next(fail(503, "Sandbox transactions are disabled."));
  app.get("/api/payments/checkout/:id", login, async (req, res) => {
    const b = await booking(db, id.parse(req.params.id), req.user.id, false);
    if (b.learner_id !== req.user.id)
      throw fail(403, "Only the learner may open checkout.");
    const a =
      (
        await db.query(
          "SELECT * FROM payment_allocations WHERE booking_id=$1",
          [b.id],
        )
      ).rows[0] || null;
    res.json({
      booking: b,
      allocation: a,
      pricing: feeSplit(
        b.amount_minor,
        a?.commission_bps ?? req.platformPolicy.commission_bps,
      ),
      provider: "sandbox",
      currency: "BDT",
      sandbox: true,
      enabled: sandboxEnabled,
      policy:
        "Simulated transactions only. Mentor delivery alone never releases an allocation. Learner confirmation or a reasoned administrator dispute decision is required; deadlines do not auto-release.",
    });
  });
  app.post(
    "/api/bookings/:id/checkout",
    approved,
    enabled,
    async (req, res) => {
      const bookingId = id.parse(req.params.id),
        body = z
          .object({
            idempotency_key: key,
            scenario: z.enum(["success", "failure"]),
          })
          .parse(req.body);
      const result = await transaction(db, async (c) => {
        const b = await booking(c, bookingId, req.user.id);
        if (b.learner_id !== req.user.id)
          throw fail(403, "Only the learner can pay for this reservation.");
        const prior = (
          await c.query(
            "SELECT * FROM payments WHERE payer_id=$1 AND idempotency_key=$2",
            [req.user.id, body.idempotency_key],
          )
        ).rows[0];
        if (prior) {
          if (prior.booking_id !== b.id || prior.scenario !== body.scenario)
            throw fail(
              409,
              "Payment key was used with different checkout data.",
            );
          return { payment: prior, duplicate: true };
        }
        if (!b.payment_required || b.amount_minor <= 0)
          throw fail(
            409,
            "This booking is free or a legacy reservation; no checkout is required.",
          );
        if (
          b.status !== "reserved" ||
          b.learning_status !== "scheduled" ||
          Date.parse(b.starts_at) <= Date.now()
        )
          throw fail(
            409,
            "Checkout is only available before an upcoming reserved session.",
          );
        if (
          !(
            await c.query(
              "SELECT l.id FROM listings l JOIN users u ON u.id=l.mentor_id JOIN categories cat ON cat.id=l.category_id WHERE l.id=$1 AND l.status='published' AND l.moderation_status='visible' AND cat.active=true AND u.suspended=false AND u.verification='approved'",
              [b.listing_id],
            )
          ).rows.length
        )
          throw fail(
            409,
            "This listing or mentor is not currently eligible for checkout.",
          );
        if (await allocationForBooking(c, b.id))
          throw fail(
            409,
            "This session already has a verified payment allocation.",
          );
        const charge = await provider.createCharge(c, {
          booking_id: b.id,
          payer_id: req.user.id,
          amount_minor: b.amount_minor,
          scenario: body.scenario,
        });
        const p = (
          await c.query(
            "INSERT INTO payments(booking_id,payer_id,provider_ref,idempotency_key,scenario,amount_minor,commission_bps) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              b.id,
              req.user.id,
              charge.reference,
              body.idempotency_key,
              body.scenario,
              b.amount_minor,
              req.platformPolicy.commission_bps,
            ],
          )
        ).rows[0];
        const applied = await applyProviderEvent(c, p, provider, {
          commissionBps: req.platformPolicy.commission_bps,
        });
        await notify(
          c,
          req.user.id,
          applied.payment.status === "succeeded"
            ? "Sandbox payment verified; session allocation held."
            : "Sandbox payment failed; you may retry.",
          `payment:${p.id}`,
        );
        return applied;
      });
      res
        .status(result.duplicate ? 200 : 201)
        .json({
          ...result,
          message:
            result.payment.status === "succeeded"
              ? "Sandbox payment verified. No real money was charged."
              : "Sandbox failure recorded. No funds were allocated.",
        });
    },
  );
  app.post("/api/payments/sandbox/webhook", enabled, async (req, res) => {
    if (
      !validWebhook(req.rawBody, req.get("X-Sandbox-Signature"), webhookSecret)
    )
      throw fail(401, "Invalid sandbox webhook signature.");
    const { provider_ref } = z.object({ provider_ref: key }).parse(req.body);
    const result = await transaction(db, async (c) => {
      const initial = (
        await c.query("SELECT * FROM payments WHERE provider_ref=$1", [
          provider_ref,
        ])
      ).rows[0];
      if (!initial) throw fail(404, "Payment not found.");
      await c.query("SELECT id FROM bookings WHERE id=$1 FOR UPDATE", [
        initial.booking_id,
      ]);
      const p = (
        await c.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
          initial.id,
        ])
      ).rows[0];
      return applyProviderEvent(c, p, provider, {
        commissionBps: req.platformPolicy.commission_bps,
      });
    });
    res.json(result);
  });
  app.get("/api/payments/summary", login, async (req, res) => {
    const user = req.user.id;
    const payments = (
      await db.query(
        "SELECT p.*,l.title,b.mentor_id FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN listings l ON l.id=b.listing_id WHERE p.payer_id=$1 ORDER BY p.id DESC",
        [user],
      )
    ).rows;
    const allocations = (
      await db.query(
        "SELECT a.*,b.learner_id,b.learning_status,l.title FROM payment_allocations a JOIN bookings b ON b.id=a.booking_id JOIN listings l ON l.id=b.listing_id WHERE b.learner_id=$1 OR a.mentor_id=$1 ORDER BY a.id DESC",
        [user],
      )
    ).rows;
    const refunds = (
      await db.query(
        "SELECT r.* FROM refunds r JOIN payment_allocations a ON a.id=r.allocation_id JOIN bookings b ON b.id=a.booking_id WHERE b.learner_id=$1 OR b.mentor_id=$1 ORDER BY r.id DESC",
        [user],
      )
    ).rows;
    const withdrawals = (
      await db.query(
        "SELECT * FROM withdrawals WHERE mentor_id=$1 ORDER BY id DESC",
        [user],
      )
    ).rows;
    const ledger = (
      await db.query(
        "SELECT * FROM wallet_entries WHERE user_id=$1 ORDER BY id DESC",
        [user],
      )
    ).rows;
    const available =
      (
        await db.query(
          "SELECT balance_minor FROM mentor_accounts WHERE user_id=$1",
          [user],
        )
      ).rows[0]?.balance_minor || 0;
    res.json({
      sandbox: true,
      currency: "BDT",
      available_minor: available,
      payments,
      allocations,
      refunds,
      withdrawals,
      ledger,
      totals: {
        paid_minor: payments
          .filter((p) => p.status === "succeeded")
          .reduce((n, p) => n + p.amount_minor, 0),
        refunded_minor: refunds
          .filter(
            (r) =>
              allocations.find((a) => a.id === r.allocation_id)?.learner_id ===
              user,
          )
          .reduce((n, r) => n + r.amount_minor, 0),
        held_earnings_minor: allocations
          .filter((a) => a.mentor_id === user && a.status === "held")
          .reduce(
            (n, a) =>
              n +
              feeSplit(a.gross_minor - a.refunded_minor, a.commission_bps)
                .mentor_minor,
            0,
          ),
        withdrawal_pending_minor: withdrawals
          .filter((w) => w.status === "pending")
          .reduce((n, w) => n + w.amount_minor, 0),
        withdrawn_minor: withdrawals
          .filter((w) => w.status === "paid")
          .reduce((n, w) => n + w.amount_minor, 0),
      },
    });
  });
  app.post("/api/withdrawals", approved, enabled, async (req, res) => {
    const b = z
      .object({
        amount_minor: z.number().int().positive().max(10000000),
        idempotency_key: key,
      })
      .parse(req.body);
    const w = await transaction(db, async (c) => {
      await lockWallet(c, req.user.id);
      const prior = (
        await c.query(
          "SELECT * FROM withdrawals WHERE mentor_id=$1 AND idempotency_key=$2",
          [req.user.id, b.idempotency_key],
        )
      ).rows[0];
      if (prior) {
        if (prior.amount_minor !== b.amount_minor)
          throw fail(
            409,
            "Withdrawal key already used for a different amount.",
          );
        return prior;
      }
      const w = (
        await c.query(
          "INSERT INTO withdrawals(mentor_id,amount_minor,idempotency_key) VALUES($1,$2,$3) RETURNING *",
          [req.user.id, b.amount_minor, b.idempotency_key],
        )
      ).rows[0];
      await walletEntry(c, {
        userId: req.user.id,
        delta: -b.amount_minor,
        kind: "withdrawal_reserved",
        reference: `withdrawal:${w.id}:reserve`,
        withdrawalId: w.id,
      });
      return w;
    });
    res
      .status(201)
      .json({
        withdrawal: w,
        message:
          "Sandbox withdrawal requested. This amount is reserved from your available simulated balance.",
      });
  });
  app.post("/api/withdrawals/:id/cancel", login, async (req, res) => {
    await transaction(db, async (c) => {
      const w = (
        await c.query("SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE", [
          id.parse(req.params.id),
        ])
      ).rows[0];
      if (!w || w.mentor_id !== req.user.id)
        throw fail(404, "Withdrawal not found.");
      if (w.status === "cancelled") return;
      if (w.status !== "pending")
        throw fail(409, "Only pending withdrawals may be cancelled.");
      await walletEntry(c, {
        userId: w.mentor_id,
        delta: w.amount_minor,
        kind: "withdrawal_returned",
        reference: `withdrawal:${w.id}:return`,
        withdrawalId: w.id,
      });
      await c.query(
        "UPDATE withdrawals SET status='cancelled',decision_reason='Cancelled by the Student Mentor.',decided_at=now() WHERE id=$1",
        [w.id],
      );
    });
    res.json({
      message:
        "Pending sandbox withdrawal cancelled; simulated balance restored.",
    });
  });
  app.get("/api/payment-disputes", login, async (req, res) => {
    const items = (
      await db.query(
        "SELECT d.*,b.learner_id,b.mentor_id,l.title,a.gross_minor,a.refunded_minor,a.on_hold,a.status allocation_status FROM payment_disputes d JOIN bookings b ON b.id=d.booking_id JOIN listings l ON l.id=b.listing_id JOIN payment_allocations a ON a.id=d.allocation_id WHERE b.learner_id=$1 OR b.mentor_id=$1 ORDER BY d.id DESC",
        [req.user.id],
      )
    ).rows;
    res.json({ items });
  });
  app.post("/api/payment-disputes", login, enabled, async (req, res) => {
    const body = z
      .object({
        booking_id: id,
        category: z.enum([
          "absence",
          "suspected_fraud",
          "inappropriate_behaviour",
          "unfulfilled_agreement",
        ]),
        reason,
      })
      .parse(req.body);
    const d = await transaction(db, async (c) => {
      const b = await booking(c, body.booking_id, req.user.id);
      const a = await allocationForBooking(c, b.id);
      if (!a || a.status !== "held")
        throw fail(
          409,
          "Only an unreleased sandbox allocation can be disputed.",
        );
      if (body.category === "absence" && Date.parse(b.ends_at) > Date.now())
        throw fail(
          409,
          "An absence complaint is available after the scheduled end.",
        );
      const d = (
        await c.query(
          "INSERT INTO payment_disputes(allocation_id,booking_id,opened_by,category,reason) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [a.id, b.id, req.user.id, body.category, body.reason],
        )
      ).rows[0];
      await c.query("UPDATE payment_allocations SET on_hold=true WHERE id=$1", [
        a.id,
      ]);
      await notify(
        c,
        b.learner_id === req.user.id ? b.mentor_id : b.learner_id,
        "A sandbox payment dispute was opened; release is on hold.",
        `dispute:${d.id}:open`,
      );
      return d;
    });
    res
      .status(201)
      .json({
        dispute: d,
        message:
          "Dispute opened. The simulated allocation is on hold until administrator resolution.",
      });
  });
  app.get("/api/payment-disputes/:id", login, async (req, res) => {
    const { d, b } = await dispute(db, id.parse(req.params.id), req.user);
    res.json({
      dispute: d,
      booking: b,
      allocation: (
        await db.query("SELECT * FROM payment_allocations WHERE id=$1", [
          d.allocation_id,
        ])
      ).rows[0],
      statements: (
        await db.query(
          "SELECT s.*,u.name FROM dispute_statements s JOIN users u ON u.id=s.user_id WHERE dispute_id=$1 ORDER BY s.id",
          [d.id],
        )
      ).rows,
      evidence: (
        await db.query(
          "SELECT e.*,f.original_name,u.name FROM dispute_evidence e JOIN files f ON f.id=e.file_id JOIN users u ON u.id=e.uploader_id WHERE dispute_id=$1 ORDER BY e.id",
          [d.id],
        )
      ).rows,
    });
  });
  app.post("/api/payment-disputes/:id/statements", login, async (req, res) => {
    const body = z
      .object({ body: z.string().trim().min(5).max(4000) })
      .parse(req.body);
    await transaction(db, async (c) => {
      const { d, b } = await dispute(
        c,
        id.parse(req.params.id),
        req.user,
        true,
      );
      if (![b.learner_id, b.mentor_id].includes(req.user.id))
        throw fail(403, "Only participants may submit statements.");
      if (d.status === "resolved") throw fail(409, "This dispute is resolved.");
      await c.query(
        "INSERT INTO dispute_statements(dispute_id,user_id,body) VALUES($1,$2,$3)",
        [d.id, req.user.id, body.body],
      );
    });
    res.status(201).json({ message: "Your dispute statement was recorded." });
  });
  app.post(
    "/api/payment-disputes/:id/evidence",
    login,
    upload.single("evidence"),
    async (req, res) => {
      const title = z.string().trim().min(2).max(120).parse(req.body.title),
        f = req.file;
      if (!f) throw fail(400, "Choose evidence to upload.");
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
          "Use a PDF, PNG, JPEG or UTF-8 TXT/MD file up to 5 MB.",
        );
      let storageKey;
      try {
        const result = await transaction(db, async (c) => {
          const { d, b } = await dispute(
            c,
            id.parse(req.params.id),
            req.user,
            true,
          );
          if (![b.learner_id, b.mentor_id].includes(req.user.id))
            throw fail(403, "Only dispute participants may upload evidence.");
          if (d.status === "resolved")
            throw fail(409, "This dispute is resolved.");
          storageKey = await storage.put(f.buffer);
          const file = (
            await c.query(
              "INSERT INTO files(owner_id,storage_key,original_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5) RETURNING id",
              [
                req.user.id,
                storageKey,
                safeFilename(f.originalname),
                type,
                f.size,
              ],
            )
          ).rows[0];
          return (
            await c.query(
              "INSERT INTO dispute_evidence(dispute_id,uploader_id,file_id,title) VALUES($1,$2,$3,$4) RETURNING *",
              [d.id, req.user.id, file.id, title],
            )
          ).rows[0];
        });
        res
          .status(201)
          .json({
            evidence: result,
            message: "Private evidence added to this dispute.",
          });
      } catch (e) {
        if (storageKey) await storage.delete(storageKey);
        throw e;
      }
    },
  );
  app.get("/api/admin/payments", admin, async (req, res) =>
    res.json({
      sandbox: true,
      payments: (
        await db.query(
          "SELECT p.*,u.name payer_name,l.title FROM payments p JOIN users u ON u.id=p.payer_id JOIN bookings b ON b.id=p.booking_id JOIN listings l ON l.id=b.listing_id ORDER BY p.id DESC LIMIT 200",
        )
      ).rows,
      allocations: (
        await db.query(
          "SELECT a.*,b.learning_status,b.learner_id FROM payment_allocations a JOIN bookings b ON b.id=a.booking_id ORDER BY a.id DESC LIMIT 200",
        )
      ).rows,
      refunds: (
        await db.query("SELECT * FROM refunds ORDER BY id DESC LIMIT 200")
      ).rows,
      withdrawals: (
        await db.query(
          "SELECT w.*,u.name FROM withdrawals w JOIN users u ON u.id=w.mentor_id ORDER BY w.id DESC LIMIT 200",
        )
      ).rows,
      accounts: (
        await db.query(
          "SELECT a.*,u.name FROM mentor_accounts a JOIN users u ON u.id=a.user_id ORDER BY a.user_id",
        )
      ).rows,
      commission_minor: Number(
        (
          await db.query(
            "SELECT COALESCE(sum(delta_minor),0) total FROM platform_ledger",
          )
        ).rows[0].total,
      ),
    }),
  );
  app.post(
    "/api/admin/allocations/:id/refunds",
    admin,
    enabled,
    async (req, res) => {
      const allocationId = id.parse(req.params.id),
        body = z
          .object({
            amount_minor: z.number().int().positive().max(10000000),
            reason,
            idempotency_key: key,
          })
          .parse(req.body);
      const result = await transaction(db, async (c) => {
        const a = await adminAllocation(c, allocationId);
        const operationKey = `admin:${req.user.id}:${body.idempotency_key}`;
        const prior = (
          await c.query("SELECT * FROM refunds WHERE operation_key=$1", [
            operationKey,
          ])
        ).rows[0];
        if (!prior && a.on_hold)
          throw fail(
            409,
            "Resolve the open dispute instead of issuing a separate refund.",
          );
        const r = await refundAllocation(c, a, {
          amount: body.amount_minor,
          reason: body.reason,
          actorId: req.user.id,
          operationKey,
          provider,
        });
        const b = (
          await c.query("SELECT learner_id FROM bookings WHERE id=$1", [
            a.booking_id,
          ])
        ).rows[0];
        await notify(
          c,
          b.learner_id,
          "A sandbox refund was recorded.",
          `refund:${r.id}`,
        );
        return r;
      });
      res
        .status(201)
        .json({
          refund: result,
          message: "Sandbox refund recorded. No real funds moved.",
        });
    },
  );
  app.post(
    "/api/admin/allocations/:id/release",
    admin,
    enabled,
    async (req, res) => {
      const body = z.object({ reason }).parse(req.body);
      const result = await transaction(db, async (c) =>
        releaseAllocation(
          c,
          await adminAllocation(c, id.parse(req.params.id)),
          { actorId: req.user.id, reason: body.reason },
        ),
      );
      res.json({
        allocation: result,
        message:
          "Confirmed sandbox allocation released to simulated mentor earnings.",
      });
    },
  );
  app.get("/api/admin/payment-disputes", admin, async (req, res) =>
    res.json({
      items: (
        await db.query(
          "SELECT d.*,l.title,u.name opened_by_name FROM payment_disputes d JOIN bookings b ON b.id=d.booking_id JOIN listings l ON l.id=b.listing_id JOIN users u ON u.id=d.opened_by ORDER BY d.id DESC",
        )
      ).rows,
      administrators: (
        await db.query(
          "SELECT u.id,u.name FROM users u JOIN admin_roles r ON r.key=u.admin_role WHERE u.role='admin' AND u.suspended=false AND (r.permissions @> ARRAY['*'] OR (r.permissions @> ARRAY['disputes.read'] AND r.permissions @> ARRAY['disputes.write'])) ORDER BY u.id",
        )
      ).rows,
    }),
  );
  app.post(
    "/api/admin/payment-disputes/:id/assign",
    admin,
    async (req, res) => {
      const body = z.object({ admin_id: id, reason }).parse(req.body);
      await transaction(db, async (c) => {
        const { d } = await dispute(c, id.parse(req.params.id), req.user, true);
        if (d.status === "resolved")
          throw fail(409, "This dispute is resolved.");
        if (
          !(
            await c.query(
              "SELECT u.id FROM users u JOIN admin_roles r ON r.key=u.admin_role WHERE u.id=$1 AND u.role='admin' AND u.suspended=false AND (r.permissions @> ARRAY['*'] OR (r.permissions @> ARRAY['disputes.read'] AND r.permissions @> ARRAY['disputes.write']))",
              [body.admin_id],
            )
          ).rows.length
        )
          throw fail(400, "Choose an active administrator.");
        await c.query(
          "UPDATE payment_disputes SET assigned_to=$1,status='under_review' WHERE id=$2",
          [body.admin_id, d.id],
        );
        await audit(
          c,
          req.user.id,
          "payment_dispute.assigned",
          d.id,
          body.reason,
        );
      });
      res.json({ message: "Dispute assignment recorded." });
    },
  );
  app.post(
    "/api/admin/payment-disputes/:id/resolve",
    admin,
    enabled,
    async (req, res) => {
      const body = z
        .object({
          outcome: z.enum(["refund", "release"]),
          refund_minor: z.number().int().positive().max(10000000).optional(),
          reason,
        })
        .parse(req.body);
      await transaction(db, async (c) => {
        const { d, b } = await dispute(
          c,
          id.parse(req.params.id),
          req.user,
          true,
        );
        if (d.status === "resolved")
          throw fail(409, "This dispute has already been resolved.");
        if (d.assigned_to && d.assigned_to !== req.user.id)
          throw fail(403, "This dispute is assigned to another administrator.");
        const a = await allocationForBooking(c, b.id);
        if (!a || a.status !== "held" || !a.on_hold)
          throw fail(
            409,
            "The dispute no longer has an unreleased held allocation.",
          );
        if (body.outcome === "refund") {
          if (!body.refund_minor)
            throw fail(400, "Provide the full or partial refund amount.");
          await refundAllocation(c, a, {
            amount: body.refund_minor,
            reason: body.reason,
            actorId: req.user.id,
            operationKey: `dispute:${d.id}:resolution`,
            provider,
          });
        } else if (body.refund_minor !== undefined)
          throw fail(400, "Release decisions cannot include a refund amount.");
        await c.query(
          "UPDATE payment_disputes SET status='resolved',outcome=$1,resolution_reason=$2,resolved_by=$3,resolved_at=now() WHERE id=$4",
          [body.outcome, body.reason, req.user.id, d.id],
        );
        await c.query(
          "UPDATE payment_allocations SET on_hold=false WHERE id=$1",
          [a.id],
        );
        const current = await allocationForBooking(c, b.id);
        if (current.status !== "refunded")
          await releaseAllocation(c, current, {
            actorId: req.user.id,
            reason: body.reason,
            override: true,
          });
        await audit(
          c,
          req.user.id,
          `payment_dispute.${body.outcome}`,
          d.id,
          body.reason,
        );
        for (const person of [b.learner_id, b.mentor_id])
          await notify(
            c,
            person,
            "Your sandbox payment dispute was resolved.",
            `dispute:${d.id}:resolved`,
          );
      });
      res.json({
        message:
          "Reasoned sandbox dispute resolution recorded; allocation and ledger updated atomically.",
      });
    },
  );
  app.post(
    "/api/admin/withdrawals/:id/decide",
    admin,
    enabled,
    async (req, res) => {
      const body = z
        .object({
          action: z.enum(["pay", "reject"]),
          scenario: z.enum(["success", "failure"]).default("success"),
          idempotency_key: key,
          reason,
        })
        .parse(req.body);
      const result = await transaction(db, async (c) => {
        const w = (
          await c.query("SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE", [
            id.parse(req.params.id),
          ])
        ).rows[0];
        if (!w) throw fail(404, "Withdrawal not found.");
        if (body.action === "pay") {
          const old = (
            await c.query(
              "SELECT * FROM sandbox_payouts WHERE operation_key=$1",
              [body.idempotency_key],
            )
          ).rows[0];
          if (old) {
            if (
              old.withdrawal_id !== w.id ||
              old.status !==
                (body.scenario === "success" ? "succeeded" : "failed")
            )
              throw fail(409, "Payout key belongs to another operation.");
            return { withdrawal: w, payout: old };
          }
        }
        if (w.status !== "pending")
          throw fail(409, "Only pending withdrawal requests may be decided.");
        let payout = null,
          status;
        if (body.action === "reject") {
          await walletEntry(c, {
            userId: w.mentor_id,
            delta: w.amount_minor,
            kind: "withdrawal_returned",
            reference: `withdrawal:${w.id}:return`,
            withdrawalId: w.id,
          });
          status = "rejected";
        } else {
          payout = await provider.payout(c, {
            withdrawal_id: w.id,
            amount_minor: w.amount_minor,
            operation_key: body.idempotency_key,
            scenario: body.scenario,
          });
          status = payout.status === "succeeded" ? "paid" : "pending";
        }
        const updated = (
          await c.query(
            "UPDATE withdrawals SET status=$1,decision_reason=$2,decided_by=$3,decided_at=now() WHERE id=$4 RETURNING *",
            [status, body.reason, req.user.id, w.id],
          )
        ).rows[0];
        await audit(
          c,
          req.user.id,
          `sandbox.withdrawal_${status}`,
          w.id,
          body.reason,
        );
        await notify(
          c,
          w.mentor_id,
          `Sandbox withdrawal ${status}.`,
          `withdrawal:${w.id}:${status}:${body.idempotency_key}`,
        );
        return { withdrawal: updated, payout };
      });
      res.json({
        ...result,
        message:
          result.payout?.status === "failed"
            ? "Sandbox payout failed. The request remains pending and its balance remains reserved."
            : "Sandbox withdrawal decision recorded. No bank transfer was made.",
      });
    },
  );
}
