import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
const fail = (status, message) => Object.assign(new Error(message), { status });
// Provider contract: createCharge, verifyCharge, refund, payout. Everything below
// is local simulation inside the same DB transaction. No real escrow or bank API.
export class SandboxPaymentProvider {
  name = "sandbox";
  supportsRealFundHolding = false;
  async createCharge(c, { booking_id, payer_id, amount_minor, scenario }) {
    const reference = randomUUID(),
      event_id = randomUUID();
    return (
      await c.query(
        "INSERT INTO sandbox_charges(reference,event_id,booking_id,payer_id,amount_minor,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          reference,
          event_id,
          booking_id,
          payer_id,
          amount_minor,
          scenario === "success" ? "succeeded" : "failed",
        ],
      )
    ).rows[0];
  }
  async verifyCharge(c, reference) {
    return (
      await c.query("SELECT * FROM sandbox_charges WHERE reference=$1", [
        reference,
      ])
    ).rows[0];
  }
  async refund(c, { charge_ref, amount_minor, operation_key }) {
    const existing = (
      await c.query("SELECT * FROM sandbox_refunds WHERE operation_key=$1", [
        operation_key,
      ])
    ).rows[0];
    if (existing) {
      if (
        existing.charge_ref !== charge_ref ||
        existing.amount_minor !== amount_minor
      )
        throw fail(409, "Refund operation key already used.");
      return existing;
    }
    const charge = (
      await c.query(
        "SELECT * FROM sandbox_charges WHERE reference=$1 FOR UPDATE",
        [charge_ref],
      )
    ).rows[0];
    const total = Number(
      (
        await c.query(
          "SELECT COALESCE(sum(amount_minor),0) total FROM sandbox_refunds WHERE charge_ref=$1",
          [charge_ref],
        )
      ).rows[0].total,
    );
    if (
      !charge ||
      charge.status !== "succeeded" ||
      amount_minor > charge.amount_minor - total
    )
      throw fail(409, "Provider refund exceeds the verified remaining charge.");
    return (
      await c.query(
        "INSERT INTO sandbox_refunds(reference,charge_ref,amount_minor,operation_key) VALUES($1,$2,$3,$4) RETURNING *",
        [randomUUID(), charge_ref, amount_minor, operation_key],
      )
    ).rows[0];
  }
  async payout(c, { withdrawal_id, amount_minor, operation_key, scenario }) {
    const prior = (
      await c.query("SELECT * FROM sandbox_payouts WHERE operation_key=$1", [
        operation_key,
      ])
    ).rows[0];
    if (prior) {
      if (
        prior.withdrawal_id !== withdrawal_id ||
        prior.amount_minor !== amount_minor ||
        prior.status !== (scenario === "success" ? "succeeded" : "failed")
      )
        throw fail(409, "Payout key already used for another operation.");
      return prior;
    }
    return (
      await c.query(
        "INSERT INTO sandbox_payouts(reference,withdrawal_id,operation_key,amount_minor,status) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          randomUUID(),
          withdrawal_id,
          operation_key,
          amount_minor,
          scenario === "success" ? "succeeded" : "failed",
        ],
      )
    ).rows[0];
  }
}
export function webhookSignature(raw, secret) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}
export function validWebhook(raw, signature, secret) {
  if (
    !raw ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/i.test(signature)
  )
    return false;
  const a = Buffer.from(signature, "hex"),
    b = Buffer.from(webhookSignature(raw, secret), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
