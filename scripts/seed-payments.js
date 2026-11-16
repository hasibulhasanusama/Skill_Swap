import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, transaction } from "../server/db.js";
import { SandboxPaymentProvider } from "../server/providers/sandbox.js";
import {
  applyProviderEvent,
  allocationForBooking,
  releaseAllocation,
  walletEntry,
} from "../server/payment-ledger.js";
const demoKey = (n) =>
  "00000000-0000-4000-8000-" + String(4000 + n).padStart(12, "0");
export async function seedPayments(db) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.DEMO_ENABLED !== "true"
  )
    throw new Error(
      "Financial demo seed requires enabled non-production demo mode.",
    );
  const provider = new SandboxPaymentProvider(),
    admin = (
      await db.query(
        "SELECT id FROM users WHERE email='admin@skillswap.test' AND role='admin'",
      )
    ).rows[0];
  if (!admin) throw new Error("Run the main demo seed first.");
  for (const [i, marker, mentorEmail, learnerEmail] of [
    [
      1,
      "stage4-completed-session",
      "student5@skillswap.test",
      "student6@skillswap.test",
    ],
    [
      2,
      "stage4-disputed-session",
      "student3@skillswap.test",
      "student7@skillswap.test",
    ],
  ])
    await transaction(db, async (c) => {
      if (
        (
          await c.query(
            "SELECT marker FROM sandbox_demo_fixtures WHERE marker=$1",
            [marker],
          )
        ).rows.length
      )
        return;
      const mentor = (
          await c.query("SELECT id FROM users WHERE email=$1", [mentorEmail])
        ).rows[0],
        learner = (
          await c.query("SELECT id FROM users WHERE email=$1", [learnerEmail])
        ).rows[0];
      const l = (
        await c.query(
          "SELECT * FROM listings WHERE mentor_id=$1 AND fee_minor>0 ORDER BY id LIMIT 1",
          [mentor.id],
        )
      ).rows[0];
      const start = new Date(Date.now() - (i + 1) * 86400000);
      start.setUTCHours(7, 0, 0, 0);
      const end = new Date(start.getTime() + l.duration_minutes * 60000);
      const slot = (
        await c.query(
          "INSERT INTO availability(listing_id,starts_at,ends_at) VALUES($1,$2,$3) RETURNING id",
          [l.id, start.toISOString(), end.toISOString()],
        )
      ).rows[0];
      const b = (
        await c.query(
          "INSERT INTO bookings(learner_id,mentor_id,listing_id,slot_id,starts_at,ends_at,amount_minor,payment_required) VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING *",
          [
            learner.id,
            mentor.id,
            l.id,
            slot.id,
            start.toISOString(),
            end.toISOString(),
            l.fee_minor,
          ],
        )
      ).rows[0];
      for (const [j, scenario] of (i === 2
        ? ["failure", "success"]
        : ["success"]
      ).entries()) {
        const charge = await provider.createCharge(c, {
          booking_id: b.id,
          payer_id: learner.id,
          amount_minor: b.amount_minor,
          scenario,
        });
        const p = (
          await c.query(
            "INSERT INTO payments(booking_id,payer_id,provider_ref,idempotency_key,scenario,amount_minor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              b.id,
              learner.id,
              charge.reference,
              demoKey(i * 10 + j),
              scenario,
              b.amount_minor,
            ],
          )
        ).rows[0];
        await applyProviderEvent(c, p, provider, { commissionBps: 1000 });
      }
      const a = await allocationForBooking(c, b.id);
      if (i === 1) {
        await c.query(
          "UPDATE bookings SET learning_status='completed',mentor_completed_at=$1,learner_confirmed_at=$1,confirmation_due_at=$2 WHERE id=$3",
          [
            end.toISOString(),
            new Date(end.getTime() + 72 * 3600000).toISOString(),
            b.id,
          ],
        );
        await releaseAllocation(c, a, {
          reason:
            "Fictional seeded session explicitly confirmed by its demo learner.",
          actorId: learner.id,
        });
        const w = (
          await c.query(
            "INSERT INTO withdrawals(mentor_id,amount_minor,idempotency_key) VALUES($1,3000,$2) RETURNING id",
            [mentor.id, demoKey(99)],
          )
        ).rows[0];
        await walletEntry(c, {
          userId: mentor.id,
          delta: -3000,
          kind: "withdrawal_reserved",
          reference: `withdrawal:${w.id}:reserve`,
          withdrawalId: w.id,
        });
      } else {
        const d = (
          await c.query(
            "INSERT INTO payment_disputes(allocation_id,booking_id,opened_by,category,reason) VALUES($1,$2,$3,'absence','Fictional demo complaint: the Student Mentor was absent from this scheduled session.') RETURNING id",
            [a.id, b.id, learner.id],
          )
        ).rows[0];
        await c.query(
          "UPDATE payment_allocations SET on_hold=true WHERE id=$1",
          [a.id],
        );
        await c.query(
          "INSERT INTO dispute_statements(dispute_id,user_id,body) VALUES($1,$2,$3)",
          [
            d.id,
            learner.id,
            "Fictional statement for administrator demonstration; no real person or payment is involved.",
          ],
        );
      }
      await c.query(
        "INSERT INTO sandbox_demo_fixtures(marker,booking_id) VALUES($1,$2)",
        [marker, b.id],
      );
    });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await seedPayments(pool);
    console.log(
      "Fictional sandbox payments, earnings and one unresolved dispute seeded.",
    );
  } finally {
    await pool.end();
  }
}
