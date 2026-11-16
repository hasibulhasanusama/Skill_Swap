export function createProjectUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  user,
  shell,
  card,
}) {
  const can = (p) =>
    user()?.permissions?.includes("*") || user()?.permissions?.includes(p);
  const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const local = (d) => {
    const p = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(d));
    const v = (k) => p.find((x) => x.type === k).value;
    return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
  };
  const externalField = (value) =>
    /* HTML */ `<label
      >Work link (optional HTTPS URL)<input
        type="url"
        name="external_url"
        value="${e(value || "")}"
        placeholder="https://your-project.example"
    /></label>`;
  const visibilityFields = (p) =>
    /* HTML */ `<label
        >Visibility<select name="visibility">
          <option
            value="private"
            ${p?.visibility !== "public" ? "selected" : ""}
          >
            Private — only me
          </option>
          <option
            value="public"
            ${p?.visibility === "public" ? "selected" : ""}
          >
            Public — show on my profile
          </option>
        </select></label
      ><label
        ><input
          type="checkbox"
          name="share_file"
          ${p?.share_file ? "checked" : ""}
        />
        Share my attachment publicly when this entry is published</label
      >
      <p class="muted">
        Publishing text does not automatically publish your file. Unpublishing
        blocks future downloads; copies already downloaded cannot be recalled.
      </p>`;
  const portfolioFields = (p) =>
    /* HTML */ `<label
        >Project title<input
          name="title"
          minlength="2"
          maxlength="120"
          value="${e(p?.title || "")}"
          required /></label
      ><label
        >What you built and learned<textarea
          name="description"
          minlength="10"
          maxlength="6000"
          required
        >
${e(p?.description || "")}</textarea></label
      >${externalField(p?.external_url)}`;
  const keys = new Map();
  let currentTask = null;
  async function tasks() {
    const [d, contexts] = await Promise.all([
      api("/projects/tasks"),
      api("/projects/contexts"),
    ]);
    const query = new URLSearchParams(location.hash.split("?")[1] || "");
    const chosen = query.get("kind") + ":" + query.get("id");
    return shell(
      "dashboard/projects",
      /* HTML */ `<div class="section-heading">
          <div>
            <div class="eyebrow">TURN PRACTICE INTO PROGRESS</div>
            <h1>Exercises & projects</h1>
          </div>
          <button class="secondary small project-refresh">Refresh</button>
        </div>
        <div class="stats">
          <div class="panel stat">
            ASSIGNED TO ME<strong>${d.progress.assigned_to_me}</strong>Stored
            project tasks
          </div>
          <div class="panel stat">
            APPROVED WORK<strong>${d.progress.approved}</strong>Latest reviewed
            submissions
          </div>
          <div class="panel stat">
            AWAITING MY
            FEEDBACK<strong>${d.progress.awaiting_my_feedback}</strong>As
            Student Mentor
          </div>
        </div>
        <details class="panel">
          <summary>Assign a task as Student Mentor</summary>
          ${
            contexts.items.length && user().verification === "approved"
              ? form(
                  "create-task",
                  /* HTML */ `<label
                      >Learning context<select name="context">
                        ${contexts.items.map((c) => `<option value="${c.context_kind}:${c.id}" ${chosen === c.context_kind + ":" + c.id ? "selected" : ""}>${e(c.title)} · ${e(c.learner_name)} · ${c.context_kind} #${c.id}</option>`).join("")}
                      </select></label
                    ><label
                      >Task type<select name="kind">
                        <option value="project">Practical project</option>
                        <option value="exercise">Exercise</option>
                      </select></label
                    ><label
                      >Title<input
                        name="title"
                        minlength="2"
                        maxlength="120"
                        required /></label
                    ><label
                      >Instructions & expected outcome<textarea
                        name="instructions"
                        minlength="10"
                        maxlength="6000"
                        required
                      ></textarea></label
                    ><label
                      >Due date (optional, Asia/Dhaka)<input
                        type="datetime-local"
                        name="due_at"
                    /></label>
                    <p>
                      Instructions are fixed after creation. Add a separate task
                      when you need a different assignment.
                    </p>`,
                  "Assign to my learner",
                )
              : "<p>Approved Student Mentors can assign tasks within their funded/free/legacy bookings or active/completed exchange teaching agreements.</p>"
          }
        </details>
        <h2 class="spaced">Your task list</h2>
        ${
          d.items
            .map(
              (t) =>
                /* HTML */ `<article class="panel exchange-card">
                  <div class="row">
                    <div>
                      <span class="pill"
                        >${e(t.kind)} ·
                        ${e(t.latest_status || "not submitted")}</span
                      >
                      <h3 class="spaced">${e(t.title)}</h3>
                      <p>
                        ${e(t.mentor_name)} teaches · ${e(t.learner_name)}
                        learns
                      </p>
                      <small
                        >${t.due_at ? "Due " + date(t.due_at) + " · Asia/Dhaka" : "No fixed due date"}${t.latest_version ? " · version " + t.latest_version : ""}</small
                      >
                    </div>
                    <a
                      class="button secondary small"
                      href="#dashboard/task/${t.id}"
                      >Open task</a
                    >
                  </div>
                </article>`,
            )
            .join("") ||
          '<div class="panel empty">No exercises or projects assigned yet.</div>'
        }`,
    );
  }
  async function taskDetail(id) {
    const d = await api("/projects/tasks/" + id);
    currentTask = id;
    const t = d.task,
      learner = t.learner_id === user().id,
      latest = d.submissions[0];
    const name = (person) =>
      e(d.participants.find((p) => p.id === person)?.name || "Student");
    return shell(
      "dashboard/projects",
      /* HTML */ `<a href="#dashboard/projects">← All tasks</a>
        <div class="eyebrow spaced">
          ${e(t.kind.toUpperCase())} / TASK #${t.id}
        </div>
        <h1>${e(t.title)}</h1>
        <div class="panel">
          <p>${name(t.mentor_id)} teaches · ${name(t.learner_id)} learns</p>
          <p class="preserve-lines">${e(t.instructions)}</p>
          <small
            >${t.due_at ? "Due " + date(t.due_at) + " · Asia/Dhaka" : "No fixed due date"}</small
          >
          <p>
            <a
              href="#dashboard/room/${t.booking_id ? "booking" : "exchange"}/${t.booking_id || t.exchange_id}"
              >Open related learning room →</a
            >
          </p>
        </div>
        ${
          learner &&
          user().verification === "approved" &&
          d.accepts_submissions &&
          (!latest || latest.status === "changes_requested")
            ? /* HTML */ `<section class="panel spaced">
                <h2>
                  ${latest ? "Submit a revised version" : "Submit your work"}
                </h2>
                ${form(
                  "submit-project",
                  /* HTML */ `<label
                      >Explain your work<textarea
                        name="summary"
                        minlength="10"
                        maxlength="6000"
                        required
                      ></textarea></label
                    >${externalField("")}<label
                      >Work attachment (optional PDF, image, TXT/MD; max 5
                      MB)<input
                        type="file"
                        name="work"
                        accept=".pdf,.png,.jpg,.jpeg,.txt,.md"
                    /></label>
                    <p>
                      Your work is not public. You and your assigned Student
                      Mentor can view it; authorized content reviewers retain
                      file-review access. Portfolio publication is a separate
                      choice.
                    </p>`,
                  "Submit private work",
                )}
              </section>`
            : ""
        }
        <h2 class="spaced">Submission & feedback history</h2>
        ${
          d.submissions
            .map(
              (s) =>
                /* HTML */ `<section class="panel exchange-card">
                  <div class="row">
                    <h3>Version ${s.version}</h3>
                    <span class="pill ${s.status === "approved" ? "teal" : ""}"
                      >${e(s.status)}</span
                    >
                  </div>
                  <p class="preserve-lines">${e(s.summary)}</p>
                  ${s.external_url ? /* HTML */ `<p><a href="${e(s.external_url)}" target="_blank" rel="noopener noreferrer">Open submitted work link ↗</a></p>` : ""}${s.file_id ? /* HTML */ `<p><a href="/api/files/${s.file_id}">Download ${e(s.original_name)}</a> · ${Math.ceil(s.size_bytes / 1024)} KB</p>` : ""}<small
                    >${date(s.created_at)} · Asia/Dhaka</small
                  >${
                    s.feedback
                      ? /* HTML */ `<div class="note">
                          <strong>Mentor feedback · ${e(s.verdict)}</strong>
                          <p class="preserve-lines">${e(s.feedback)}</p>
                        </div>`
                      : ""
                  }${!learner && user().verification === "approved" && s.status === "submitted" && s.id === latest?.id ? form("feedback-" + s.id, '<label>Decision<select name="verdict"><option value="changes_requested">Request a revised version</option><option value="approved">Approve this work</option></select></label><label>Practical feedback<textarea name="comment" minlength="10" maxlength="6000" required></textarea></label>', "Record feedback") : ""}${learner && s.status === "approved" ? (s.portfolio_id ? '<p><a href="#dashboard/portfolio">Manage this work in my portfolio →</a></p>' : `<details class="spaced"><summary>Add this approved work to my portfolio</summary>${form("portfolio-from-" + s.id, portfolioFields({ title: t.title, description: s.summary, external_url: s.external_url }) + visibilityFields(), "Save portfolio entry")}</details>`) : ""}
                </section>`,
            )
            .join("") || '<div class="panel empty">No work submitted yet.</div>'
        }`,
    );
  }
  async function portfolio() {
    const d = await api("/portfolio");
    return shell(
      "dashboard/portfolio",
      /* HTML */ `<div class="section-heading">
          <div>
            <div class="eyebrow">A RECORD OF WHAT YOU CAN DO</div>
            <h1>My portfolio</h1>
          </div>
          <a href="#mentor/${user().id}">View my public profile →</a>
        </div>
        <p>
          Keep work private or publish it yourself. Mentor approval is feedback
          on that task; it is not a certification or proof of teaching ability.
        </p>
        <details class="panel">
          <summary>Add an independent project</summary>
          ${user().verification === "approved" ? form("independent-portfolio", portfolioFields() + '<label>Work attachment (optional PDF, image, TXT/MD; max 5 MB)<input type="file" name="work" accept=".pdf,.png,.jpg,.jpeg,.txt,.md"></label>' + visibilityFields(), "Save my project") : "<p>Approved student verification is required to add or publish portfolio projects.</p>"}
        </details>
        <h2 class="spaced">Your work</h2>
        ${
          d.items
            .map(
              (p) =>
                /* HTML */ `<section class="panel exchange-card">
                  <div class="row">
                    <div>
                      <h3>${e(p.title)}</h3>
                      <span class="pill"
                        >${e(p.visibility)}${p.moderation_status === "hidden" ? " · hidden by administrator" : ""}</span
                      >
                      <p>
                        ${p.submission_id ? "From mentor-approved project work" : "Independent student project"}
                      </p>
                    </div>
                    ${p.visibility === "public" && p.moderation_status === "visible" ? /* HTML */ `<a href="#portfolio/${p.id}">View public entry →</a>` : ""}
                  </div>
                  ${p.moderation_status === "hidden" ? /* HTML */ `<div class="note error">Administrator reason: ${e(p.moderation_reason)}. Editing does not bypass moderation.</div>` : ""}${p.file_id ? /* HTML */ `<p><a href="/api/files/${p.file_id}">View my private attachment: ${e(p.original_name)}</a></p>` : ""}${form("portfolio-edit-" + p.id, portfolioFields(p) + visibilityFields(p), "Save visibility & changes")}
                </section>`,
            )
            .join("") ||
          '<div class="panel empty">Your portfolio is empty. Add independent work or publish an approved project submission.</div>'
        }`,
    );
  }
  async function publicEntry(id) {
    const { entry: p } = await api("/portfolio/" + id);
    return /* HTML */ `<div class="intro">
      <a href="#mentor/${p.owner_id}">← ${e(p.owner_name)}'s profile</a>
      <div class="eyebrow spaced">
        STUDENT PORTFOLIO /
        ${p.reviewed_project ? "MENTOR-REVIEWED TASK" : "INDEPENDENT PROJECT"}
      </div>
      <h1>${e(p.title)}</h1>
      <p>${e(p.owner_name)} · ${e(p.institution)}</p>
      <section class="panel">
        <p class="preserve-lines">${e(p.description)}</p>
        <div class="actions">
          ${p.external_url ? /* HTML */ `<a class="button secondary" href="${e(p.external_url)}" target="_blank" rel="noopener noreferrer">Open project ↗</a>` : ""}${p.has_attachment ? /* HTML */ `<a class="button secondary" href="/api/portfolio/${p.id}/file">Download shared work</a>` : ""}
        </div>
        <small
          >Published by the student. A reviewed task is not a professional
          certification.</small
        >
      </section>
    </div>`;
  }
  async function reviews() {
    const d = await api("/reviews");
    return shell(
      "dashboard/reviews",
      /* HTML */ `<div class="eyebrow">FEEDBACK FROM ACTUAL PARTICIPANTS</div>
        <h1>Reviews</h1>
        <p>
          Only learners in confirmed completed bookings and participants in
          fully completed reciprocal exchanges can review. One review per
          eligible context; you cannot review yourself.
        </p>
        <section class="panel">
          <h2>Share your learning experience</h2>
          ${
            d.eligible.length
              ? form(
                  "create-review",
                  /* HTML */ `<label
                      >Completed learning context<select name="context">
                        ${d.eligible.map((c) => `<option value="${c.context_kind}:${c.id}">${e(c.title)} · ${e(c.subject_name)} · ${c.context_kind} #${c.id}</option>`).join("")}
                      </select></label
                    ><label
                      >Rating<select name="rating">
                        <option value="5">5 — Excellent</option>
                        <option value="4">4 — Good</option>
                        <option value="3">3 — Fair</option>
                        <option value="2">2 — Needs improvement</option>
                        <option value="1">1 — Poor</option>
                      </select></label
                    ><label
                      >Your review<textarea
                        name="comment"
                        minlength="10"
                        maxlength="6000"
                        required
                      ></textarea>
                    </label>`,
                  "Submit eligible review",
                )
              : "<p>No unreviewed eligible sessions or exchanges yet.</p>"
          }
        </section>
        <h2 class="spaced">Reviews you wrote</h2>
        ${
          d.issued
            .map(
              (r) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>${e(r.subject_name)} · ${r.rating}/5</h3>
                  <p class="preserve-lines">${e(r.comment)}</p>
                  <span class="pill"
                    >${r.moderation_status === "hidden" ? "Hidden by administrator" : r.eligible_now === false ? "Not public: completion eligibility changed" : "Visible when the context remains eligible"}</span
                  >${r.moderation_reason ? /* HTML */ `<p>${e(r.moderation_reason)}</p>` : ""}
                </section>`,
            )
            .join("") ||
          '<div class="panel empty">You have not written any reviews.</div>'
        }
        <h2 class="spaced">Public reviews of your teaching</h2>
        ${
          d.received
            .map(
              (r) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>${e(r.author_name)} · ${r.rating}/5</h3>
                  <p>${e(r.comment)}</p>
                  <small>${date(r.created_at)} · ${e(r.context_kind)}</small>
                </section>`,
            )
            .join("") || "<p>No eligible public reviews yet.</p>"
        }`,
    );
  }
  async function saved() {
    const d = await api("/saved-skills");
    return shell(
      "dashboard/saved",
      /* HTML */ `<div class="eyebrow">YOUR NEXT LEARNING IDEAS</div>
        <h1>Saved skills</h1>
        <div class="grid">
          ${d.items.map((l) => /* HTML */ `<div>${card(l)}<button class="secondary small spaced remove-saved" data-id="${l.id}">Remove saved skill</button></div>`).join("") || '<div class="panel empty">No saved skills. <a href="#explore">Explore the marketplace →</a></div>'}
        </div>`,
    );
  }
  async function moderation(type) {
    const d = await api("/admin/" + type);
    return shell(
      "admin/" + type,
      /* HTML */ `<div class="eyebrow">CONTENT REVIEW</div>
        <h1>${type === "reviews" ? "Review" : "Portfolio"} moderation</h1>
        <p>
          Latest 200 records. Hiding removes public content; restoring still
          respects the student's visibility choice and review eligibility.
        </p>
        ${
          d.items
            .map(
              (r) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>
                    ${type === "reviews" ? e(r.author_name) + " → " + e(r.subject_name) + " · " + r.rating + "/5" : e(r.title) + " · " + e(r.owner_name)}
                  </h3>
                  <p class="preserve-lines">
                    ${e(type === "reviews" ? r.comment : r.description)}
                  </p>
                  <p>
                    ${e(r.moderation_status)}${r.visibility ? " · student visibility: " + e(r.visibility) : ""}
                  </p>
                  ${r.moderation_reason ? /* HTML */ `<p>Last reason: ${e(r.moderation_reason)}</p>` : ""}${can(type + ".write") ? form("moderate-" + type + "-" + r.id, '<label>Public moderation status<select name="status"><option value="hidden">Hide from public pages</option><option value="visible">Restore if otherwise eligible</option></select></label><label>Reason<textarea name="reason" minlength="10" maxlength="3000" required></textarea></label>', "Record moderation decision") : ""}
                </section>`,
            )
            .join("") ||
          '<div class="panel empty">No content to moderate yet.</div>'
        }`,
      true,
    );
  }
  async function render(route) {
    if (route === "dashboard/projects") return tasks();
    if (route.startsWith("dashboard/task/"))
      return taskDetail(Number(route.split("/")[2]));
    if (route === "dashboard/portfolio") return portfolio();
    if (route.startsWith("portfolio/"))
      return publicEntry(Number(route.split("/")[1]));
    if (route === "dashboard/reviews") return reviews();
    if (route === "dashboard/saved") return saved();
    return moderation(route.split("/")[1]);
  }
  function wire() {
    document
      .querySelectorAll(".project-refresh")
      .forEach((b) => b.addEventListener("click", refresh));
    bind("create-task", async (b) => {
      const [context_kind, context_id] = b.context.split(":");
      const r = await api("/projects/tasks", "POST", {
        context_kind,
        context_id: Number(context_id),
        kind: b.kind,
        title: b.title,
        instructions: b.instructions,
        due_at: b.due_at
          ? new Date(b.due_at + ":00+06:00").toISOString()
          : null,
      });
      notice(r.message);
      location.hash = "dashboard/task/" + r.task.id;
    });
    bind("submit-project", async (b, f) => {
      const data = new FormData(f),
        file = data.get("work");
      if (!file?.size) data.delete("work");
      const fingerprint = JSON.stringify({
        task: currentTask,
        summary: b.summary,
        url: b.external_url,
        file: file?.size
          ? `${file.name}:${file.size}:${file.lastModified}`
          : "",
      });
      const key = keys.get(fingerprint) || crypto.randomUUID();
      keys.set(fingerprint, key);
      data.set("client_key", key);
      notice(
        (
          await api(
            "/projects/tasks/" + currentTask + "/submissions",
            "POST",
            data,
          )
        ).message,
      );
      keys.delete(fingerprint);
      refresh();
    });
    document.querySelectorAll('[id^="feedback-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await api(
              "/project-submissions/" + f.id.split("-").pop() + "/feedback",
              "POST",
              b,
            )
          ).message,
        );
        refresh();
      }),
    );
    document.querySelectorAll('[id^="portfolio-from-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await api(
              "/project-submissions/" + f.id.split("-").pop() + "/portfolio",
              "POST",
              { ...b, share_file: b.share_file === "on" },
            )
          ).message,
        );
        location.hash = "dashboard/portfolio";
      }),
    );
    bind("independent-portfolio", async (b, f) => {
      const data = new FormData(f);
      data.set("share_file", b.share_file === "on" ? "true" : "false");
      if (!data.get("work")?.size) data.delete("work");
      notice((await api("/portfolio", "POST", data)).message);
      refresh();
    });
    document.querySelectorAll('[id^="portfolio-edit-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await api("/portfolio/" + f.id.split("-").pop(), "PUT", {
              ...b,
              share_file: b.share_file === "on",
            })
          ).message,
        );
        refresh();
      }),
    );
    bind("create-review", async (b) => {
      const [context_kind, context_id] = b.context.split(":");
      notice(
        (
          await api("/reviews", "POST", {
            context_kind,
            context_id: Number(context_id),
            rating: Number(b.rating),
            comment: b.comment,
          })
        ).message,
      );
      refresh();
    });
    document
      .querySelectorAll(".remove-saved")
      .forEach((b) =>
        b.addEventListener("click", () =>
          runButton(b, () => api("/saved-skills/" + b.dataset.id, "DELETE")),
        ),
      );
    document.querySelectorAll('[id^="moderate-"]').forEach((f) =>
      bind(f.id, async (b) => {
        const [, type, id] = f.id.split("-");
        notice((await api(`/admin/${type}/${id}/moderate`, "POST", b)).message);
        refresh();
      }),
    );
  }
  function runButton(b, run) {
    b.disabled = true;
    Promise.resolve()
      .then(run)
      .then((r) => {
        notice(r.message);
        refresh();
      })
      .catch((err) => notice(err.message))
      .finally(() => (b.disabled = false));
  }
  return { render, wire };
}
