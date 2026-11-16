import "./test-environment.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { migrateDatabase } from "../server/migrations.js";
import { seed } from "../scripts/seed.js";
import { feeSplit } from "../server/payment-ledger.js";
import { webhookSignature } from "../server/providers/sandbox.js";
let db,
  app,
  storage,
  mentor,
  learner,
  outsider,
  admin,
  main,
  paid,
  allocation,
  seq = 0;
const secret = "test-only-sandbox-webhook-secret-32-characters";
const post = (a, url, body = {}) =>
  a.agent
    .post("/api" + url)
    .set("X-CSRF-Token", a.csrf)
    .send(body);
async function login(email) {
  const agent = request.agent(app);
  let r = await agent.get("/api/auth/me");
  r = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", r.body.csrf)
    .send({ email, password: "StudentDemo!2026" });
  assert.equal(r.status, 200);
  return { agent, csrf: r.body.csrf, user: r.body.user };
}
async function reserve() {
  const starts = new Date(Date.now() + (30 + seq++ * 2) * 86400000);
  starts.setUTCHours(15, 0, 0, 0);
  const slot = await post(mentor, "/listings/1/slots", {
    starts_at: starts.toISOString(),
  });
  assert.equal(slot.status, 201);
  const r = await post(learner, "/bookings", { slot_id: slot.body.slot.id });
  assert.equal(r.status, 201);
  return r.body.booking;
}
const checkout = (b, scenario = "success", idempotency_key = randomUUID()) =>
  post(learner, `/bookings/${b.id}/checkout`, {
    scenario,
    idempotency_key,
    amount_minor: 1,
    status: "succeeded",
    currency: "USD",
  });
const allocationFor = async (b) =>
  (
    await db.query("SELECT * FROM payment_allocations WHERE booking_id=$1", [
      b.id,
    ])
  ).rows[0];
const balance = async () =>
  Number(
    (await mentor.agent.get("/api/payments/summary")).body.available_minor,
  );
async function elapsed(b) {
  await db.query(
    "UPDATE bookings SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=$1",
    [b.id],
  );
}
before(async () => {
  process.env.DEMO_ENABLED = "true";
  db = new PGlite();
  await migrateDatabase(db);
  await seed(db);
  storage = await mkdtemp(path.join(os.tmpdir(), "payments-"));
  app = createApp({
    db,
    storageDir: storage,
    secret: "payment-test-session-secret-32-characters",
    webhookSecret: secret,
    commissionBps: 1000,
  });
  mentor = await login("student1@skillswap.test");
  learner = await login("student3@skillswap.test");
  outsider = await login("student5@skillswap.test");
  admin = await login("admin@skillswap.test");
});
after(async () => {
  await db.close();
  if (storage) await rm(storage, { recursive: true, force: true });
});
test("new paid bookings require checkout; legacy bookings remain compatible", async () => {
  const b = await reserve();
  assert.equal(b.payment_required, true);
  await elapsed(b);
  assert.equal((await post(mentor, `/bookings/${b.id}/complete`)).status, 409);
  await db.query("UPDATE bookings SET payment_required=false WHERE id=$1", [
    b.id,
  ]);
  assert.equal((await post(mentor, `/bookings/${b.id}/complete`)).status, 200);
  assert.equal((await post(learner, `/bookings/${b.id}/confirm`)).status, 200);
  assert.equal(await balance(), 0);
  main = await reserve();
  assert.equal(
    (await mentor.agent.get(`/api/payments/checkout/${main.id}`)).status,
    403,
  );
  assert.equal(
    (await outsider.agent.get(`/api/payments/checkout/${main.id}`)).status,
    404,
  );
});
test("sandbox failure is persistent and retryable without trusting browser prices or statuses", async () => {
  const key = randomUUID(),
    r = await checkout(main, "failure", key);
  assert.equal(r.status, 201);
  assert.equal(r.body.payment.status, "failed");
  assert.equal(r.body.payment.amount_minor, main.amount_minor);
  assert.equal(await allocationFor(main), undefined);
  assert.equal((await checkout(main, "failure", key)).status, 200);
  assert.equal((await checkout(main, "success", key)).status, 409);
  assert.equal(
    (
      await post(mentor, `/bookings/${main.id}/checkout`, {
        scenario: "success",
        idempotency_key: randomUUID(),
      })
    ).status,
    403,
  );
  const second = await checkout(main);
  assert.equal(second.status, 201);
  paid = second.body.payment;
  allocation = await allocationFor(main);
  assert.equal(allocation.status, "held");
  assert.equal(allocation.gross_minor, main.amount_minor);
  assert.equal(allocation.commission_bps, 1000);
  assert.equal(await balance(), 0);
  const quote = (await learner.agent.get(`/api/payments/checkout/${main.id}`))
    .body;
  assert.deepEqual(quote.pricing, feeSplit(main.amount_minor, 1000));
});
test("duplicate successful payments and signed provider events cannot allocate twice", async () => {
  const oldKey = paid.idempotency_key;
  assert.equal(
    (await checkout(main, "success", oldKey)).body.payment.id,
    paid.id,
  );
  assert.equal((await checkout(main)).status, 409);
  const raw = JSON.stringify({ provider_ref: paid.provider_ref });
  assert.equal(
    (
      await request(app)
        .post("/api/payments/sandbox/webhook")
        .send({ provider_ref: paid.provider_ref })
    ).status,
    401,
  );
  const sig = webhookSignature(raw, secret);
  const replay = await request(app)
    .post("/api/payments/sandbox/webhook")
    .set("Content-Type", "application/json")
    .set("X-Sandbox-Signature", sig)
    .send(raw);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM payment_allocations WHERE booking_id=$1",
        [main.id],
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM payment_events WHERE payment_id=$1",
        [paid.id],
      )
    ).rows[0].count,
    1,
  );
  await db.query(
    "UPDATE sandbox_charges SET amount_minor=amount_minor+1 WHERE reference=$1",
    [paid.provider_ref],
  );
  assert.equal(
    (
      await request(app)
        .post("/api/payments/sandbox/webhook")
        .set("Content-Type", "application/json")
        .set("X-Sandbox-Signature", sig)
        .send(raw)
    ).status,
    409,
  );
  await db.query(
    "UPDATE sandbox_charges SET amount_minor=amount_minor-1 WHERE reference=$1",
    [paid.provider_ref],
  );
});
test("mentor completion and expired response deadlines alone never release simulated earnings", async () => {
  await elapsed(main);
  assert.equal(
    (await post(mentor, `/bookings/${main.id}/complete`)).status,
    200,
  );
  assert.equal(await balance(), 0);
  await db.query(
    "UPDATE bookings SET confirmation_due_at=now()-interval '2 days' WHERE id=$1",
    [main.id],
  );
  assert.equal((await allocationFor(main)).status, "held");
  assert.equal(
    (
      await post(admin, `/admin/allocations/${allocation.id}/release`, {
        reason: "An expired deadline is not a release authorization.",
      })
    ).status,
    409,
  );
  assert.equal(
    (await post(learner, `/bookings/${main.id}/confirm`)).status,
    200,
  );
  const split = feeSplit(main.amount_minor, 1000);
  assert.equal(await balance(), split.mentor_minor);
  const a = await allocationFor(main);
  assert.equal(a.commission_released_minor, split.commission_minor);
  assert.equal(
    (await post(learner, `/bookings/${main.id}/confirm`)).status,
    409,
  );
  assert.equal(
    (
      await post(admin, `/admin/allocations/${a.id}/release`, {
        reason: "Idempotent repeat of a confirmed allocation release.",
      })
    ).status,
    200,
  );
  assert.equal(await balance(), split.mentor_minor);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM wallet_entries WHERE allocation_id=$1 AND kind=$2",
        [a.id, "release"],
      )
    ).rows[0].count,
    1,
  );
});
test("partial refunds reverse net earnings and commission exactly; duplicate and excessive refunds fail safely", async () => {
  const key = randomUUID(),
    body = {
      amount_minor: 3001,
      reason: "A partial sandbox refund agreed after session review.",
      idempotency_key: key,
    };
  assert.equal(
    (await post(learner, `/admin/allocations/${allocation.id}/refunds`, body))
      .status,
    403,
  );
  const r = await post(
    admin,
    `/admin/allocations/${allocation.id}/refunds`,
    body,
  );
  assert.equal(r.status, 201);
  assert.equal(
    (await post(admin, `/admin/allocations/${allocation.id}/refunds`, body))
      .body.refund.id,
    r.body.refund.id,
  );
  assert.equal(
    (
      await post(admin, `/admin/allocations/${allocation.id}/refunds`, {
        ...body,
        amount_minor: 3002,
      })
    ).status,
    409,
  );
  const a = await allocationFor(main),
    split = feeSplit(main.amount_minor - 3001, 1000);
  assert.equal(a.refunded_minor, 3001);
  assert.equal(await balance(), split.mentor_minor);
  assert.equal(a.commission_released_minor, split.commission_minor);
  assert.equal(
    (
      await post(admin, `/admin/allocations/${allocation.id}/refunds`, {
        amount_minor: main.amount_minor,
        reason: "This refund exceeds the remaining balance.",
        idempotency_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await db.query("SELECT count(*) FROM refunds WHERE allocation_id=$1", [
        allocation.id,
      ])
    ).rows[0].count,
    1,
  );
});
test("withdrawals reserve balance, reject overspending and cancel idempotently", async () => {
  const before = await balance(),
    key = randomUUID();
  const r = await post(mentor, "/withdrawals", {
    amount_minor: 2000,
    idempotency_key: key,
  });
  assert.equal(r.status, 201);
  assert.equal(await balance(), before - 2000);
  assert.equal(
    (
      await post(mentor, "/withdrawals", {
        amount_minor: 2000,
        idempotency_key: key,
      })
    ).body.withdrawal.id,
    r.body.withdrawal.id,
  );
  assert.equal(await balance(), before - 2000);
  assert.equal(
    (
      await post(mentor, "/withdrawals", {
        amount_minor: before,
        idempotency_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (await post(outsider, `/withdrawals/${r.body.withdrawal.id}/cancel`))
      .status,
    404,
  );
  assert.equal(
    (await post(mentor, `/withdrawals/${r.body.withdrawal.id}/cancel`)).status,
    200,
  );
  assert.equal(
    (await post(mentor, `/withdrawals/${r.body.withdrawal.id}/cancel`)).status,
    200,
  );
  assert.equal(await balance(), before);
});
test("sandbox payout failure stays pending, retry and duplicate events cannot pay twice", async () => {
  const before = await balance();
  const r = await post(mentor, "/withdrawals", {
      amount_minor: 1000,
      idempotency_key: randomUUID(),
    }),
    w = r.body.withdrawal;
  const failedKey = randomUUID(),
    body = {
      action: "pay",
      scenario: "failure",
      idempotency_key: failedKey,
      reason: "Fictional failure to demonstrate provider retry behavior.",
    };
  const failed = await post(admin, `/admin/withdrawals/${w.id}/decide`, body);
  assert.equal(failed.status, 200);
  assert.equal(failed.body.withdrawal.status, "pending");
  assert.equal(failed.body.payout.status, "failed");
  assert.equal(await balance(), before - 1000);
  assert.equal(
    (await post(admin, `/admin/withdrawals/${w.id}/decide`, body)).body.payout
      .reference,
    failed.body.payout.reference,
  );
  const successBody = {
    ...body,
    scenario: "success",
    idempotency_key: randomUUID(),
    reason: "Approved simulated payout after a successful retry.",
  };
  const success = await post(
    admin,
    `/admin/withdrawals/${w.id}/decide`,
    successBody,
  );
  assert.equal(success.body.withdrawal.status, "paid");
  assert.equal(
    (await post(admin, `/admin/withdrawals/${w.id}/decide`, successBody)).body
      .payout.reference,
    success.body.payout.reference,
  );
  assert.equal((await post(mentor, `/withdrawals/${w.id}/cancel`)).status, 409);
  assert.equal(await balance(), before - 1000);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM sandbox_payouts WHERE withdrawal_id=$1 AND status='succeeded'",
        [w.id],
      )
    ).rows[0].count,
    1,
  );
});
test("released refunds cannot overdraw earnings reserved or paid out", async () => {
  const before = await balance(),
    a = await allocationFor(main);
  const w = await post(mentor, "/withdrawals", {
    amount_minor: before,
    idempotency_key: randomUUID(),
  });
  assert.equal(w.status, 201);
  const count = Number(
    (await db.query("SELECT count(*) FROM sandbox_refunds")).rows[0].count,
  );
  assert.equal(
    (
      await post(admin, `/admin/allocations/${a.id}/refunds`, {
        amount_minor: a.gross_minor - a.refunded_minor,
        reason: "A full refund must not overdraw earnings already withdrawn.",
        idempotency_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    Number(
      (await db.query("SELECT count(*) FROM sandbox_refunds")).rows[0].count,
    ),
    count,
  );
  assert.equal(
    (await post(mentor, `/withdrawals/${w.body.withdrawal.id}/cancel`)).status,
    200,
  );
  assert.equal(await balance(), before);
});
test("absence disputes hold allocations, block confirmation/release and protect evidence", async () => {
  const b = await reserve();
  assert.equal((await checkout(b)).status, 201);
  await elapsed(b);
  assert.equal((await post(mentor, `/bookings/${b.id}/complete`)).status, 200);
  const r = await post(learner, "/payment-disputes", {
    booking_id: b.id,
    category: "absence",
    reason: "The Student Mentor did not attend the scheduled session.",
  });
  assert.equal(r.status, 201);
  const d = r.body.dispute,
    a = await allocationFor(b);
  assert.equal(a.on_hold, true);
  assert.equal((await post(learner, `/bookings/${b.id}/confirm`)).status, 409);
  assert.equal(
    (
      await post(admin, `/admin/allocations/${a.id}/release`, {
        reason: "A held allocation cannot be manually released.",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(admin, `/admin/allocations/${a.id}/refunds`, {
        amount_minor: 100,
        reason: "Open disputes must use the resolution workflow.",
        idempotency_key: randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(learner, "/payment-disputes", {
        booking_id: b.id,
        category: "absence",
        reason: "A duplicate unresolved complaint must be rejected.",
      })
    ).status,
    409,
  );
  assert.equal(
    (await outsider.agent.get(`/api/payment-disputes/${d.id}`)).status,
    404,
  );
  assert.equal(
    (
      await post(mentor, `/payment-disputes/${d.id}/statements`, {
        body: "My explanation is available for the administrator to review.",
      })
    ).status,
    201,
  );
  const evidence = await learner.agent
    .post(`/api/payment-disputes/${d.id}/evidence`)
    .set("X-CSRF-Token", learner.csrf)
    .field("title", "Fictional absence notes")
    .attach(
      "evidence",
      Buffer.from("Fictional test evidence of absence."),
      "evidence.txt",
    );
  assert.equal(evidence.status, 201);
  const file = evidence.body.evidence.file_id;
  assert.equal((await mentor.agent.get("/api/files/" + file)).status, 200);
  assert.equal((await admin.agent.get("/api/files/" + file)).status, 200);
  assert.equal((await outsider.agent.get("/api/files/" + file)).status, 404);
  assert.equal(
    (
      await post(admin, `/admin/payment-disputes/${d.id}/assign`, {
        admin_id: outsider.user.id,
        reason: "A student cannot be assigned as an administrator.",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(admin, `/admin/payment-disputes/${d.id}/assign`, {
        admin_id: admin.user.id,
        reason: "Assigned to the demo administrator for review.",
      })
    ).status,
    200,
  );
  const resolved = await post(
    admin,
    `/admin/payment-disputes/${d.id}/resolve`,
    {
      outcome: "refund",
      refund_minor: b.amount_minor,
      reason: "Fictional evidence supports a full refund for absence.",
    },
  );
  assert.equal(resolved.status, 200);
  const current = await allocationFor(b);
  assert.equal(current.status, "refunded");
  assert.equal(current.on_hold, false);
  assert.equal(
    (await db.query("SELECT status FROM bookings WHERE id=$1", [b.id])).rows[0]
      .status,
    "cancelled",
  );
  assert.equal(
    (
      await post(admin, `/admin/payment-disputes/${d.id}/resolve`, {
        outcome: "release",
        reason: "A resolved dispute cannot be changed again.",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(mentor, `/payment-disputes/${d.id}/statements`, {
        body: "Late statement after the resolution.",
      })
    ).status,
    409,
  );
});
test("partial dispute refund releases only the reasoned remainder and conserves gross totals", async () => {
  const b = await reserve();
  await checkout(b);
  await elapsed(b);
  const before = await balance();
  const d = (
    await post(learner, "/payment-disputes", {
      booking_id: b.id,
      category: "unfulfilled_agreement",
      reason: "Only part of the agreed session objectives was delivered.",
    })
  ).body.dispute;
  const result = await post(admin, `/admin/payment-disputes/${d.id}/resolve`, {
    outcome: "refund",
    refund_minor: 5000,
    reason: "Refund the undelivered portion and release the agreed remainder.",
  });
  assert.equal(result.status, 200);
  const a = await allocationFor(b),
    split = feeSplit(b.amount_minor - 5000, 1000);
  assert.equal(a.status, "released");
  assert.equal(await balance(), before + split.mentor_minor);
  assert.equal(
    a.gross_minor,
    a.refunded_minor + a.mentor_released_minor + a.commission_released_minor,
  );
  assert.equal(
    (await db.query("SELECT learning_status FROM bookings WHERE id=$1", [b.id]))
      .rows[0].learning_status,
    "scheduled",
  );
});
test("full held refunds, admin withdrawal rejection and ledger totals remain consistent", async () => {
  const b = await reserve();
  await checkout(b);
  const a = await allocationFor(b),
    before = await balance();
  const r = await post(admin, `/admin/allocations/${a.id}/refunds`, {
    amount_minor: b.amount_minor,
    reason: "Full simulated refund before any session delivery.",
    idempotency_key: randomUUID(),
  });
  assert.equal(r.status, 201);
  assert.equal(await balance(), before);
  const w = (
    await post(mentor, "/withdrawals", {
      amount_minor: 100,
      idempotency_key: randomUUID(),
    })
  ).body.withdrawal;
  assert.equal(
    (
      await post(admin, `/admin/withdrawals/${w.id}/decide`, {
        action: "reject",
        reason: "The fictional withdrawal needs additional review.",
        idempotency_key: randomUUID(),
      })
    ).status,
    200,
  );
  assert.equal(await balance(), before);
  const ledgerTotal = Number(
    (
      await db.query(
        "SELECT COALESCE(sum(delta_minor),0) total FROM wallet_entries WHERE user_id=$1",
        [mentor.user.id],
      )
    ).rows[0].total,
  );
  assert.equal(ledgerTotal, await balance());
  const sum = await admin.agent.get("/api/admin/payments");
  assert.equal(sum.status, 200);
  assert.equal(
    sum.body.commission_minor,
    Number(
      (
        await db.query(
          "SELECT COALESCE(sum(commission_released_minor),0) total FROM payment_allocations",
        )
      ).rows[0].total,
    ),
  );
  assert.equal((await learner.agent.get("/api/admin/payments")).status, 403);
  assert.ok(
    (await admin.agent.get("/api/admin/audit")).body.items.some(
      (x) => x.action === "sandbox.refund",
    ),
  );
});
test("reasoned release resolution is explicit and full released refunds reverse all net/commission", async () => {
  const b = await reserve();
  await checkout(b);
  const d = (
    await post(learner, "/payment-disputes", {
      booking_id: b.id,
      category: "suspected_fraud",
      reason: "A fictional concern for an administrator to investigate.",
    })
  ).body.dispute;
  const before = await balance();
  assert.equal(
    (
      await post(admin, `/admin/payment-disputes/${d.id}/resolve`, {
        outcome: "release",
        refund_minor: 1,
        reason: "A release cannot contain a refund value.",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(admin, `/admin/payment-disputes/${d.id}/resolve`, {
        outcome: "release",
        reason:
          "Fictional evidence resolves the concern in favor of the mentor.",
      })
    ).status,
    200,
  );
  let a = await allocationFor(b);
  assert.equal(a.status, "released");
  assert.equal(
    await balance(),
    before + feeSplit(b.amount_minor, 1000).mentor_minor,
  );
  assert.equal(
    (
      await post(admin, `/admin/allocations/${a.id}/refunds`, {
        amount_minor: b.amount_minor,
        reason:
          "Later full reversal is possible while earnings remain available.",
        idempotency_key: randomUUID(),
      })
    ).status,
    201,
  );
  a = await allocationFor(b);
  assert.equal(a.status, "refunded");
  assert.equal(a.mentor_released_minor, 0);
  assert.equal(a.commission_released_minor, 0);
  assert.equal(await balance(), before);
});
test("sandbox disabling and fee rounding are explicit", async () => {
  assert.deepEqual(feeSplit(1, 1000), {
    gross_minor: 1,
    commission_minor: 0,
    mentor_minor: 1,
  });
  assert.deepEqual(feeSplit(199, 1000), {
    gross_minor: 199,
    commission_minor: 19,
    mentor_minor: 180,
  });
  const disabled = createApp({
    db,
    storageDir: storage,
    secret: "disabled-payment-test-session-secret-32-characters",
    sandboxEnabled: false,
  });
  const r = await request(disabled)
    .post("/api/payments/sandbox/webhook")
    .send({ provider_ref: paid.provider_ref });
  assert.equal(r.status, 503);
  assert.throws(
    () =>
      createApp({
        db,
        storageDir: storage,
        secret: "test-session-secret-that-is-at-least-32-characters",
        commissionBps: 10001,
      }),
    /COMMISSION_BPS/,
  );
});
