import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAdministrationUI } from "../public/administration.js";
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let dom;
function setup(responses, { permissions = ["*"], role = "admin" } = {}) {
  dom?.window.close();
  dom = new JSDOM('<main id="app"></main>', { url: "http://localhost:3000" });
  global.document = dom.window.document;
  global.window = dom.window;
  global.location = dom.window.location;
  global.HashChangeEvent = dom.window.HashChangeEvent;
  const callbacks = {},
    calls = [];
  let failNext = false,
    refreshed = 0;
  const api = async (url, method = "GET", body) => {
    calls.push({ url, method, body });
    if (method === "GET") return responses[url];
    if (failNext) {
      failNext = false;
      throw Error("Temporary network failure");
    }
    return { message: "Saved" };
  };
  const ui = createAdministrationUI({
    api,
    e,
    form: (id, body, label) =>
      `<form id="${id}">${body}<button type="submit">${label}</button><p class="form-error"></p></form>`,
    bind: (id, fn) => (callbacks[id] = fn),
    notice: () => {},
    date: (d) => new Date(d).toISOString(),
    money: (n) => String(n / 100),
    user: () => ({ id: 9, role, permissions }),
    shell: (route, body) => body,
    refreshUser: async () => refreshed++,
    onSignedOut: async () => {},
  });
  return {
    ui,
    callbacks,
    calls,
    fail: () => (failNext = true),
    refreshed: () => refreshed,
  };
}
after(() => {
  dom?.window.close();
  delete global.document;
  delete global.window;
  delete global.location;
  delete global.HashChangeEvent;
});
test("read-only student management shows search/results without mutation forms", async () => {
  const x = setup(
    {
      "/admin/users?": {
        items: [
          {
            id: 1,
            name: "Demo Student",
            email: "demo@example.test",
            institution: "Fictional College",
            verification: "approved",
            suspended: false,
          },
        ],
        total: 1,
        page: 1,
        pages: 1,
      },
    },
    { permissions: ["users.read"] },
  );
  document.querySelector("#app").innerHTML = await x.ui.render("admin/users");
  x.ui.wire();
  assert.equal(document.querySelectorAll('[id^="student-status-"]').length, 0);
  assert.equal(document.querySelectorAll("#student-search").length, 1);
  assert.ok(
    document.querySelector("#app").textContent.includes("Demo Student"),
  );
});
test("policy form serializes the exact revision, percentage and checkbox states", async () => {
  const p = {
    revision: 3,
    commission_bps: 1000,
    completion_response_hours: 72,
    cancellation_notice_hours: 24,
    registration_open: true,
    listing_publication_open: true,
    policy_text: "Fictional platform policy text for the demonstration.",
  };
  const x = setup({ "/admin/policies": { policy: p } });
  document.querySelector("#app").innerHTML =
    await x.ui.render("admin/policies");
  x.ui.wire();
  await x.callbacks["policy-edit"]({
    revision: "3",
    commission_percent: "12.50",
    completion_response_hours: "48",
    cancellation_notice_hours: "12",
    registration_open: "on",
    policy_text: p.policy_text,
    reason: "A documented policy change for the demo.",
  });
  const b = x.calls.find((c) => c.method === "PUT").body;
  assert.equal(b.revision, 3);
  assert.equal(b.commission_bps, 1250);
  assert.equal(b.listing_publication_open, false);
  assert.equal(b.registration_open, true);
  assert.equal(b.completion_response_hours, 48);
});
test("account settings keep public profile and activity/reminder preferences distinct", async () => {
  const x = setup(
    {
      "/account/settings": {
        settings: {
          profile_public: true,
          notifications: { activity: true, session_reminders: true },
        },
      },
    },
    { role: "student", permissions: [] },
  );
  document.querySelector("#app").innerHTML =
    await x.ui.render("dashboard/account");
  x.ui.wire();
  await x.callbacks["account-settings"]({ activity: "on" });
  const b = x.calls.find((c) => c.method === "PUT").body;
  assert.equal(b.profile_public, false);
  assert.deepEqual(b.notifications, {
    activity: true,
    session_reminders: false,
  });
  assert.equal(x.refreshed(), 1);
});
test("cancellation retries preserve the operation key rather than submitting browser refund amounts", async () => {
  const x = setup(
    {
      "/account/commitments": {
        bookings: [
          {
            id: 7,
            title: "Demo session",
            starts_at: "2030-01-01T12:00:00Z",
            status: "reserved",
            cancellation: {
              allowed: true,
              reason: "Full remaining sandbox refund.",
            },
          },
        ],
        exchanges: [],
        exchange_cancellations: [],
      },
    },
    { role: "student", permissions: [] },
  );
  document.querySelector("#app").innerHTML = await x.ui.render(
    "dashboard/commitments",
  );
  x.ui.wire();
  const b = { reason: "An early timetable conflict requires cancellation." };
  x.fail();
  await assert.rejects(x.callbacks["cancel-booking-7"](b), /network/);
  await x.callbacks["cancel-booking-7"](b);
  const attempts = x.calls.filter((c) => c.method === "POST");
  assert.equal(
    attempts[0].body.idempotency_key,
    attempts[1].body.idempotency_key,
  );
  assert.deepEqual(Object.keys(attempts[0].body).sort(), [
    "idempotency_key",
    "reason",
  ]);
});
