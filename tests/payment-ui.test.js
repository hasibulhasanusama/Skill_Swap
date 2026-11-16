import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createPaymentUI } from "../public/payments.js";
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let dom;
function setup(responses) {
  dom?.window.close();
  dom = new JSDOM('<main id="app"></main>', { url: "http://localhost:3000" });
  global.document = dom.window.document;
  global.window = dom.window;
  global.location = dom.window.location;
  global.HashChangeEvent = dom.window.HashChangeEvent;
  const callbacks = {},
    calls = [];
  let failNext = false;
  const api = async (url, method = "GET", body) => {
    calls.push({ url, method, body });
    if (method === "GET") return responses[url];
    if (failNext) {
      failNext = false;
      throw Error("Temporary network failure");
    }
    return { message: "Sandbox action recorded." };
  };
  const ui = createPaymentUI({
    api,
    e,
    form: (id, body, label) =>
      `<form id="${id}">${body}<button type="submit">${label}</button><p class="form-error"></p></form>`,
    bind: (id, fn) => (callbacks[id] = fn),
    notice: () => {},
    date: (d) => new Date(d).toISOString(),
    money: (n) => "BDT " + (n / 100).toFixed(2),
    user: () => ({ id: 9, role: "admin", permissions: ["*"] }),
    shell: (route, body) => body,
  });
  return { ui, callbacks, calls, fail: () => (failNext = true) };
}
after(() => {
  dom?.window.close();
  delete global.document;
  delete global.window;
  delete global.location;
  delete global.HashChangeEvent;
});
test("sandbox checkout displays server breakdown and retries with the same key without browser prices", async () => {
  const x = setup({
    "/payments/checkout/7": {
      booking: {
        id: 7,
        amount_minor: 15000,
        payment_required: true,
        status: "reserved",
        learning_status: "scheduled",
        starts_at: "2030-01-01T12:00:00Z",
      },
      allocation: null,
      pricing: {
        gross_minor: 15000,
        commission_minor: 1500,
        mentor_minor: 13500,
      },
      enabled: true,
      policy: "Simulated payments only.",
    },
  });
  document.querySelector("#app").innerHTML = await x.ui.render("checkout/7");
  x.ui.wire();
  assert.ok(document.querySelector("#app").textContent.includes("BDT 150.00"));
  assert.ok(
    document.querySelector("#app").textContent.includes("SANDBOX ONLY"),
  );
  assert.equal(
    document.querySelectorAll("[name=card],[name=amount],[name=amount_minor]")
      .length,
    0,
  );
  x.fail();
  await assert.rejects(
    x.callbacks["sandbox-checkout"]({ scenario: "success", amount_minor: 1 }),
    /network/,
  );
  await x.callbacks["sandbox-checkout"]({
    scenario: "success",
    amount_minor: 1,
  });
  const requests = x.calls.filter((c) => c.method === "POST");
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].body.idempotency_key,
    requests[1].body.idempotency_key,
  );
  assert.deepEqual(Object.keys(requests[0].body).sort(), [
    "idempotency_key",
    "scenario",
  ]);
});
test("withdrawal form converts exact BDT decimals to minor units and rejects ambiguous amounts", async () => {
  const x = setup({
    "/payments/summary": {
      available_minor: 20000,
      totals: {
        held_earnings_minor: 0,
        paid_minor: 0,
        refunded_minor: 0,
        withdrawal_pending_minor: 0,
        withdrawn_minor: 0,
      },
      payments: [],
      allocations: [],
      refunds: [],
      withdrawals: [],
      ledger: [],
    },
  });
  document.querySelector("#app").innerHTML =
    await x.ui.render("dashboard/payments");
  x.ui.wire();
  await assert.rejects(x.callbacks.withdraw({ amount: "1e2" }), /decimal/);
  await assert.rejects(x.callbacks.withdraw({ amount: "1.234" }), /decimal/);
  await x.callbacks.withdraw({ amount: "12.34" });
  const body = x.calls.find((c) => c.method === "POST").body;
  assert.equal(body.amount_minor, 1234);
  assert.ok(body.idempotency_key);
});
test("administrator release resolution does not send a stale refund value", async () => {
  const x = setup({
    "/payment-disputes/4": {
      dispute: {
        id: 4,
        category: "absence",
        status: "open",
        reason: "Fictional absence complaint.",
      },
      booking: {
        id: 3,
        learner_id: 1,
        mentor_id: 2,
        learning_status: "scheduled",
      },
      allocation: {
        gross_minor: 15000,
        refunded_minor: 0,
        status: "held",
        on_hold: true,
      },
      statements: [],
      evidence: [],
    },
    "/admin/payment-disputes": {
      administrators: [{ id: 9, name: "Demo Administrator" }],
    },
  });
  document.querySelector("#app").innerHTML =
    await x.ui.render("admin/dispute/4");
  x.ui.wire();
  const select = document.querySelector("#resolution-outcome");
  select.value = "release";
  select.dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("[name=refund_bdt]").disabled, true);
  await x.callbacks["resolve-payment-dispute"]({
    id: "4",
    outcome: "release",
    refund_bdt: "100.00",
    reason: "Fictional reviewed evidence supports release.",
  });
  const body = x.calls.find((c) => c.method === "POST").body;
  assert.equal(body.outcome, "release");
  assert.equal(Object.hasOwn(body, "refund_minor"), false);
});
