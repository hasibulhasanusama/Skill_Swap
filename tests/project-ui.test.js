import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createProjectUI } from "../public/projects.js";
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
  dom = new JSDOM('<main id="app"></main>', {
    url: "http://localhost:3000/#dashboard/projects?kind=booking&id=7",
  });
  global.document = dom.window.document;
  global.window = dom.window;
  global.location = dom.window.location;
  global.HashChangeEvent = dom.window.HashChangeEvent;
  const callbacks = {},
    calls = [];
  const api = async (url, method = "GET", body) => {
    calls.push({ url, method, body });
    return method === "GET"
      ? responses[url]
      : { message: "Saved", task: { id: 8 } };
  };
  const ui = createProjectUI({
    api,
    e,
    form: (id, body, label) =>
      `<form id="${id}">${body}<button type="submit">${label}</button><p class="form-error"></p></form>`,
    bind: (id, fn) => (callbacks[id] = fn),
    notice: () => {},
    date: (d) => new Date(d).toISOString(),
    user: () => ({ id: 1, verification: "approved" }),
    shell: (route, body) => body,
    card: (l) => `<article>${e(l.title)}</article>`,
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
test("task assignment uses an allowed context and serializes optional Dhaka due dates", async () => {
  const x = setup({
    "/projects/tasks": {
      items: [],
      progress: { assigned_to_me: 0, approved: 0, awaiting_my_feedback: 0 },
    },
    "/projects/contexts": {
      items: [
        {
          context_kind: "booking",
          id: 7,
          title: "Web design",
          learner_name: "Demo Learner",
        },
      ],
    },
  });
  document.querySelector("#app").innerHTML =
    await x.ui.render("dashboard/projects");
  x.ui.wire();
  assert.equal(document.querySelector("[name=context]").value, "booking:7");
  await x.callbacks["create-task"]({
    context: "booking:7",
    kind: "exercise",
    title: "Build an accessible form",
    instructions: "Add clear input labels and keyboard navigation.",
    due_at: "2030-01-01T18:00",
  });
  const r = x.calls.find((c) => c.method === "POST");
  assert.equal(r.body.context_kind, "booking");
  assert.equal(r.body.context_id, 7);
  assert.equal(r.body.due_at, "2030-01-01T12:00:00.000Z");
  assert.equal(Object.hasOwn(r.body, "learner_id"), false);
});
test("portfolio editing defaults to private and does not implicitly publish work attachments", async () => {
  const entry = {
    id: 9,
    title: "Draft project",
    description: "A private fictional project with a work attachment.",
    external_url: "",
    visibility: "private",
    share_file: false,
    moderation_status: "visible",
    file_id: 14,
    original_name: "work.txt",
    submission_id: 4,
  };
  const x = setup({ "/portfolio": { items: [entry] } });
  document.querySelector("#app").innerHTML = await x.ui.render(
    "dashboard/portfolio",
  );
  x.ui.wire();
  const f = document.querySelector("#portfolio-edit-9");
  assert.equal(f.querySelector("[name=visibility]").value, "private");
  assert.equal(f.querySelector("[name=share_file]").checked, false);
  await x.callbacks["portfolio-edit-9"]({
    title: entry.title,
    description: entry.description,
    external_url: "",
    visibility: "public",
  });
  const r = x.calls.find((c) => c.method === "PUT");
  assert.equal(r.body.visibility, "public");
  assert.equal(r.body.share_file, false);
});
test("review form only sends the selected eligible context and numeric rating", async () => {
  const x = setup({
    "/reviews": {
      eligible: [
        {
          context_kind: "exchange",
          id: 5,
          title: "Web design ↔ English",
          subject_name: "Demo Partner",
        },
      ],
      issued: [],
      received: [],
    },
  });
  document.querySelector("#app").innerHTML =
    await x.ui.render("dashboard/reviews");
  x.ui.wire();
  await x.callbacks["create-review"]({
    context: "exchange:5",
    rating: "4",
    comment: "Both participants completed the agreed practice sessions.",
    subject_id: "1",
  });
  const body = x.calls.find((c) => c.method === "POST").body;
  assert.equal(body.context_kind, "exchange");
  assert.equal(body.context_id, 5);
  assert.equal(body.rating, 4);
  assert.equal(Object.hasOwn(body, "subject_id"), false);
});
test("public portfolio view renders safe descriptions and only the consented attachment route", async () => {
  const x = setup({
    "/portfolio/9": {
      entry: {
        id: 9,
        owner_id: 2,
        owner_name: "Demo Student",
        institution: "Fictional College",
        title: "<script>unsafe</script>",
        description: "<img src=x onerror=alert(1)>",
        external_url: "",
        reviewed_project: false,
        has_attachment: true,
      },
    },
  });
  document.querySelector("#app").innerHTML = await x.ui.render("portfolio/9");
  assert.equal(document.querySelectorAll("script,img").length, 0);
  assert.ok(
    document
      .querySelector("#app")
      .textContent.includes("<script>unsafe</script>"),
  );
  assert.equal(
    document.querySelector('a[href="/api/portfolio/9/file"]').textContent,
    "Download shared work",
  );
  assert.equal(document.querySelectorAll('a[href^="/api/files/"]').length, 0);
});
