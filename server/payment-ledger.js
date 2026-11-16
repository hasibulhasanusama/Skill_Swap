const fail = (status, message) => Object.assign(new Error(message), { status });
export const feeSplit = (gross, bps) => {
  const commission = Math.floor((gross * bps) / 10000);
  return {
    gross_minor: gross,
    commission_minor: commission,
    mentor_minor: gross - commission,
  };
};
export async function lockWallet(c, userId) {
  await c.query(
    "INSERT INTO mentor_accounts(user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [userId],
  );
  return (
    await c.query("SELECT * FROM mentor_accounts WHERE user_id=$1 FOR UPDATE", [
      userId,
    ])
  ).rows[0];
}
export async function walletEntry(
  c,
  { userId, delta, kind, reference, allocationId = null, withdrawalId = null },
) {
  const account = await lockWallet(c, userId);
  const old = (
    await c.query("SELECT * FROM wallet_entries WHERE reference=$1", [
      reference,
    ])
  ).rows[0];
  if (old) {
    if (old.user_id !== userId || old.delta_minor !== delta)
      throw fail(409, "Ledger reference conflict.");
    return old;
  }
  if (account.balance_minor + delta < 0)
    throw fail(
      409,
      "Available simulated earnings are insufficient; a pending or paid withdrawal may prevent reversal.",
    );
  await c.query(
    "UPDATE mentor_accounts SET balance_minor=balance_minor+$1 WHERE user_id=$2",
    [delta, userId],
  );
  return (
    await c.query(
      "INSERT INTO wallet_entries(user_id,delta_minor,kind,reference,allocation_id,withdrawal_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [userId, delta, kind, reference, allocationId, withdrawalId],
    )
  ).rows[0];
}
export async function allocationForBooking(c, bookingId) {
  return (
    await c.query(
      "SELECT * FROM payment_allocations WHERE booking_id=$1 FOR UPDATE",
      [bookingId],
    )
  ).rows[0];
}
export async function releaseAllocation(
  c,
  allocation,
  { reason, actorId, override = false },
) {
  const a = (
    await c.query("SELECT * FROM payment_allocations WHERE id=$1 FOR UPDATE", [
      allocation.id,
    ])
  ).rows[0];
  if (a.status === "released") return a;
  if (a.status === "refunded")
    throw fail(409, "Allocation was fully refunded.");
  const open = Number(
    (
      await c.query(
        "SELECT count(*) FROM payment_disputes WHERE allocation_id=$1 AND status IN ('open','under_review')",
        [a.id],
      )
    ).rows[0].count,
  );
  if (a.on_hold || open) throw fail(409, "The allocation is on dispute hold.");
  const b = (
    await c.query("SELECT * FROM bookings WHERE id=$1", [a.booking_id])
  ).rows[0];
  if (!override && !b.learner_confirmed_at)
    throw fail(
      409,
      "Learner confirmation or a reasoned dispute resolution is required.",
    );
  const split = feeSplit(a.gross_minor - a.refunded_minor, a.commission_bps);
  await walletEntry(c, {
    userId: a.mentor_id,
    delta: split.mentor_minor,
    kind: "release",
    reference: `allocation:${a.id}:release`,
    allocationId: a.id,
  });
  await c.query(
    "INSERT INTO platform_ledger(delta_minor,reference,allocation_id) VALUES($1,$2,$3)",
    [split.commission_minor, `allocation:${a.id}:release`, a.id],
  );
  const result = (
    await c.query(
      "UPDATE payment_allocations SET status='released',mentor_released_minor=$1,commission_released_minor=$2,released_at=now() WHERE id=$3 RETURNING *",
      [split.mentor_minor, split.commission_minor, a.id],
    )
  ).rows[0];
  await c.query(
    "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
    [actorId, "sandbox.allocation_released", String(a.id), reason],
  );
  return result;
}
export async function requireFundedBooking(c, b) {
  if (!b.payment_required) return null;
  const a = await allocationForBooking(c, b.id);
  if (!a || a.status === "refunded")
    throw fail(
      409,
      "Successful sandbox checkout is required for this paid reservation.",
    );
  return a;
}
export async function releaseForConfirmedBooking(c, b, actorId) {
  const a = await requireFundedBooking(c, b);
  return a
    ? releaseAllocation(c, a, {
        actorId,
        reason: "Learner explicitly confirmed session delivery.",
      })
    : null;
}
export async function applyProviderEvent(
  c,
  payment,
  provider,
  { commissionBps },
) {
  const charge = await provider.verifyCharge(c, payment.provider_ref);
  if (
    !charge ||
    charge.booking_id !== payment.booking_id ||
    charge.payer_id !== payment.payer_id ||
    charge.amount_minor !== payment.amount_minor ||
    charge.currency !== "BDT"
  )
    throw fail(
      409,
      "Provider verification did not match the server payment record.",
    );
  const prior = (
    await c.query("SELECT * FROM payment_events WHERE event_id=$1", [
      charge.event_id,
    ])
  ).rows[0];
  if (prior) {
    if (prior.payment_id !== payment.id)
      throw fail(409, "Provider event already belongs to another payment.");
    return {
      duplicate: true,
      payment: (
        await c.query("SELECT * FROM payments WHERE id=$1", [payment.id])
      ).rows[0],
    };
  }
  await c.query(
    "INSERT INTO payment_events(event_id,payment_id) VALUES($1,$2)",
    [charge.event_id, payment.id],
  );
  const result = (
    await c.query("UPDATE payments SET status=$1 WHERE id=$2 RETURNING *", [
      charge.status,
      payment.id,
    ])
  ).rows[0];
  if (charge.status === "succeeded") {
    const b = (
      await c.query("SELECT * FROM bookings WHERE id=$1", [payment.booking_id])
    ).rows[0];
    await c.query(
      "INSERT INTO payment_allocations(booking_id,payment_id,mentor_id,gross_minor,commission_bps) VALUES($1,$2,$3,$4,$5)",
      [
        b.id,
        payment.id,
        b.mentor_id,
        payment.amount_minor,
        payment.commission_bps ?? commissionBps,
      ],
    );
  }
  return { duplicate: false, payment: result };
}
export async function refundAllocation(
  c,
  allocation,
  { amount, reason, actorId, operationKey, provider },
) {
  const prior = (
    await c.query("SELECT * FROM refunds WHERE operation_key=$1", [
      operationKey,
    ])
  ).rows[0];
  if (prior) {
    if (
      prior.allocation_id !== allocation.id ||
      prior.amount_minor !== amount ||
      prior.reason !== reason
    )
      throw fail(409, "Refund idempotency key was used with different data.");
    return prior;
  }
  const a = (
    await c.query("SELECT * FROM payment_allocations WHERE id=$1 FOR UPDATE", [
      allocation.id,
    ])
  ).rows[0];
  if (
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > a.gross_minor - a.refunded_minor
  )
    throw fail(409, "Refund exceeds the remaining paid amount.");
  const remaining = a.gross_minor - a.refunded_minor - amount,
    newSplit = feeSplit(remaining, a.commission_bps);
  if (a.released_at) {
    await walletEntry(c, {
      userId: a.mentor_id,
      delta: newSplit.mentor_minor - a.mentor_released_minor,
      kind: "refund",
      reference: `refund:${operationKey}`,
      allocationId: a.id,
    });
    await c.query(
      "INSERT INTO platform_ledger(delta_minor,reference,allocation_id) VALUES($1,$2,$3)",
      [
        newSplit.commission_minor - a.commission_released_minor,
        `refund:${operationKey}`,
        a.id,
      ],
    );
  }
  const payment = (
    await c.query("SELECT * FROM payments WHERE id=$1", [a.payment_id])
  ).rows[0];
  const receipt = await provider.refund(c, {
    charge_ref: payment.provider_ref,
    amount_minor: amount,
    operation_key: operationKey,
  });
  const refund = (
    await c.query(
      "INSERT INTO refunds(allocation_id,amount_minor,provider_ref,operation_key,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [a.id, amount, receipt.reference, operationKey, actorId, reason],
    )
  ).rows[0];
  await c.query(
    "UPDATE payment_allocations SET refunded_minor=refunded_minor+$1,status=$2,mentor_released_minor=$3,commission_released_minor=$4 WHERE id=$5",
    [
      amount,
      remaining === 0 ? "refunded" : a.status,
      a.released_at ? newSplit.mentor_minor : 0,
      a.released_at ? newSplit.commission_minor : 0,
      a.id,
    ],
  );
  if (remaining === 0)
    await c.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [
      a.booking_id,
    ]);
  await c.query(
    "INSERT INTO audit_logs(actor_id,action,target,reason) VALUES($1,$2,$3,$4)",
    [actorId, "sandbox.refund", String(refund.id), reason],
  );
  return refund;
}
