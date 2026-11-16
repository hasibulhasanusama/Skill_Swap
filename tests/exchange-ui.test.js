import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createExchangeUI } from "../public/exchanges.js";
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
  const api = async (url, method = "GET", body) => {
    calls.push({ url, method, body });
    return method === "GET" ? responses[url] : { message: "Saved" };
  };
  const ui = createExchangeUI({
    api,
    e,
    form: (id, body, label) =>
      `<form id="${id}">${body}<button type="submit">${label}</button><p class="form-error"></p></form>`,
    bind: (id, callback) => {
      callbacks[id] = callback;
    },
    notice: () => {},
    date: (d) => new Date(d).toISOString(),
    user: () => ({ id: 1 }),
    shell: (route, body) => body,
  });
  return { ui, callbacks, calls };
}
after(() => {
  dom?.window.close();
  delete global.document;
  delete global.window;
  delete global.location;
  delete global.HashChangeEvent;
});
test("preference UI adds and removes rows and preserves midnight availability", async () => {
  const { ui, callbacks, calls } = setup({
    "/exchange/preferences": {
      skills: [{ skill: "web design", kind: "teach", level: 3 }],
      availability: [{ weekday: 2, start_minute: 1200, end_minute: 1440 }],
    },
  });
  document.querySelector("#app").innerHTML = await ui.render(
    "dashboard/preferences",
  );
  ui.wire();
  assert.equal(document.querySelector("[name=end]").value, "00:00");
  document.querySelector("#add-skill").click();
  assert.equal(document.querySelectorAll(".skill-row").length, 2);
  const row = document.querySelectorAll(".skill-row")[1];
  row.querySelector("[name=skill]").value = "public speaking";
  row.querySelector("[name=kind]").value = "learn";
  document.querySelector("#add-availability").click();
  assert.equal(document.querySelectorAll(".availability-row").length, 2);
  document
    .querySelectorAll(".availability-row")[1]
    .querySelector(".remove-row")
    .click();
  assert.equal(document.querySelectorAll(".availability-row").length, 1);
  await callbacks.preferences({}, document.querySelector("#preferences"));
  const saved = calls.find((c) => c.method === "PUT").body;
  assert.equal(saved.skills.length, 2);
  assert.equal(saved.skills[1].kind, "learn");
  assert.equal(saved.availability[0].end_minute, 1440);
  assert.equal(saved.availability[0].weekday, 2);
});
test("agreement UI submits revision and converts Dhaka inputs to UTC timestamps", async () => {
  const x = {
    id: 7,
    requester_id: 1,
    recipient_id: 2,
    requester_name: "Student One",
    recipient_name: "Student Two",
    requester_skill: "web design",
    recipient_skill: "public speaking",
    message: "A demo exchange.",
    status: "negotiating",
    revision: 2,
    requester_objective: "Present a clear project story.",
    recipient_objective: "Build a responsive webpage.",
    requester_accepted: false,
    recipient_accepted: false,
    sessions: [
      {
        id: 9,
        teacher_id: 1,
        starts_at: "2030-01-01T12:00:00Z",
        ends_at: "2030-01-01T13:00:00Z",
      },
      {
        id: 10,
        teacher_id: 2,
        starts_at: "2030-01-02T12:00:00Z",
        ends_at: "2030-01-02T13:00:00Z",
      },
    ],
    reports: [],
  };
  const { ui, callbacks, calls } = setup({ "/exchanges": { items: [x] } });
  document.querySelector("#app").innerHTML = await ui.render(
    "dashboard/exchanges",
  );
  ui.wire();
  const f = document.querySelector("#agreement-7");
  assert.equal(f.querySelector("[name=starts_at]").value, "2030-01-01T18:00");
  const b = Object.fromEntries(new dom.window.FormData(f));
  await callbacks["agreement-7"](b, f);
  const saved = calls.find((c) => c.method === "PUT");
  assert.equal(saved.body.revision, 2);
  assert.equal(saved.body.sessions.length, 2);
  assert.equal(saved.body.sessions[0].starts_at, "2030-01-01T12:00:00.000Z");
  assert.equal(saved.body.sessions[0].duration_minutes, 60);
  assert.deepEqual(
    saved.body.sessions.map((s) => s.teacher_id),
    [1, 2],
  );
  assert.equal(
    document.querySelector(".accept-agreement").dataset.revision,
    "2",
  );
});
test("match UI renders explanations safely and sends the selected reciprocal skills", async () => {
  const { ui, callbacks, calls } = setup({
    "/exchange/matches": {
      method: "Rules-based matching.",
      items: [
        {
          student: {
            id: 2,
            name: "Student <Two>",
            institution: "Fictional College",
          },
          score: 90,
          give: ["web design"],
          receive: ["public speaking"],
          explanations: ["Both available Tuesday 18:00–20:00 (Asia/Dhaka)."],
        },
      ],
    },
  });
  document.querySelector("#app").innerHTML =
    await ui.render("dashboard/matches");
  ui.wire();
  assert.ok(
    document.querySelector("#app").textContent.includes("Student <Two>"),
  );
  assert.equal(document.querySelectorAll("two").length, 0);
  const f = document.querySelector("#request-2");
  f.querySelector("[name=message]").value =
    "Let us work on a presentation together.";
  await callbacks["request-2"](
    Object.fromEntries(new dom.window.FormData(f)),
    f,
  );
  const posted = calls.find((c) => c.method === "POST");
  assert.equal(posted.body.recipient_id, 2);
  assert.equal(posted.body.requester_skill, "web design");
  assert.equal(posted.body.recipient_skill, "public speaking");
  assert.equal(window.location.hash, "#dashboard/exchanges");
});
