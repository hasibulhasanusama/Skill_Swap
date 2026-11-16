import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createLearningUI } from "../public/learning.js";
const e = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let dom;
function fixture() {
  dom?.window.close();
  dom = new JSDOM('<main id="app"></main>', { url: "http://localhost:3000" });
  global.document = dom.window.document;
  global.window = dom.window;
  global.HashChangeEvent = dom.window.HashChangeEvent;
  global.FormData = dom.window.FormData;
  const callbacks = {},
    calls = [];
  const data = {
    kind: "booking",
    id: 4,
    record: { id: 4, status: "reserved" },
    participants: [
      { id: 1, name: "Mentor One" },
      { id: 2, name: "Learner Two" },
    ],
    writable: true,
    sessions: [
      {
        id: 4,
        teacher_id: 1,
        session_kind: "booking",
        starts_at: "2030-01-01T12:00:00Z",
        ends_at: "2030-01-01T13:00:00Z",
        learning_status: "scheduled",
        meeting_url: "",
      },
    ],
    materials: [],
    reschedules: [],
    attendance: [],
  };
  let userId = 1,
    failNext = false;
  const api = async (url, method = "GET", body) => {
    calls.push({ url, method, body });
    if (method === "GET")
      return url.endsWith("/messages")
        ? {
            items: [
              {
                id: 1,
                sender_id: 2,
                sender_name: "Learner Two",
                body: "<img src=x onerror=alert(1)>",
                created_at: "2026-11-16T12:00:00Z",
              },
            ],
            has_more: false,
          }
        : data;
    if (failNext && url.endsWith("/messages")) {
      failNext = false;
      throw Error("Temporary network failure");
    }
    return { message: "Saved" };
  };
  const ui = createLearningUI({
    api,
    e,
    form: (id, body, text) =>
      `<form id="${id}">${body}<button type="submit">${text}</button><p class="form-error"></p></form>`,
    bind: (id, fn) => (callbacks[id] = fn),
    notice: () => {},
    date: (d) => new Date(d).toISOString(),
    user: () => ({ id: userId }),
    shell: (route, body) => body,
  });
  return {
    ui,
    callbacks,
    calls,
    data,
    setUser: (id) => (userId = id),
    failNextMessage: () => (failNext = true),
  };
}
after(() => {
  dom?.window.close();
  delete global.document;
  delete global.window;
  delete global.HashChangeEvent;
  delete global.FormData;
});
test("learning room safely renders chat and serializes Dhaka reschedule times", async () => {
  const { ui, callbacks, calls } = fixture();
  document.querySelector("#app").innerHTML = await ui.render(
    "dashboard/room/booking/4",
  );
  ui.wire();
  assert.equal(document.querySelectorAll("#message-list img").length, 0);
  assert.ok(
    document.querySelector("#message-list").textContent.includes("<img"),
  );
  const f = document.querySelector("#reschedule-booking-4");
  assert.equal(f.querySelector("[name=starts_at]").value, "2030-01-02T18:00");
  await callbacks["reschedule-booking-4"](
    { starts_at: "2030-01-02T18:00", reason: "Please move this session." },
    f,
  );
  const sent = calls.find((c) => c.url.endsWith("/reschedules"));
  assert.equal(sent.body.starts_at, "2030-01-02T12:00:00.000Z");
  assert.equal(document.querySelectorAll("#attendance-booking-4").length, 0);
});
test("message retry retains an idempotency key and new content gets a new key", async () => {
  const f = fixture();
  document.querySelector("#app").innerHTML = await f.ui.render(
    "dashboard/room/booking/4",
  );
  f.ui.wire();
  const form = document.querySelector("#send-message");
  f.failNextMessage();
  await assert.rejects(
    f.callbacks["send-message"]({ body: "Practice this project" }, form),
    /network/,
  );
  await f.callbacks["send-message"]({ body: "Practice this project" }, form);
  await f.callbacks["send-message"]({ body: "Another question" }, form);
  const sends = f.calls.filter(
    (c) => c.method === "POST" && c.url.endsWith("/messages"),
  );
  assert.equal(sends[0].body.client_key, sends[1].body.client_key);
  assert.notEqual(sends[1].body.client_key, sends[2].body.client_key);
});
test("learner cannot edit mentor links and completed rooms hide mutation forms", async () => {
  const f = fixture();
  f.setUser(2);
  document.querySelector("#app").innerHTML = await f.ui.render(
    "dashboard/room/booking/4",
  );
  assert.equal(document.querySelectorAll('[id^="meeting-"]').length, 0);
  f.data.writable = false;
  f.data.sessions[0].learning_status = "completed";
  f.data.sessions[0].mentor_completed_at = "2029-12-31T12:00:00Z";
  f.data.sessions[0].learner_confirmed_at = "2029-12-31T13:00:00Z";
  document.querySelector("#app").innerHTML = await f.ui.render(
    "dashboard/room/booking/4",
  );
  assert.equal(
    document.querySelectorAll(
      '#send-message,#material-upload,[id^="reschedule-"]',
    ).length,
    0,
  );
  assert.ok(document.querySelector("#app").textContent.includes("read-only"));
});
