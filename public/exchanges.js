export function createExchangeUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  user,
  shell,
}) {
  const can = (p) =>
    user()?.permissions?.includes("*") || user()?.permissions?.includes(p);
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const levels = ["", "Beginner", "Intermediate", "Advanced"];
  const time = (n) =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  const minutes = (t) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
  const local = (d) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(d));
    const get = (k) => parts.find((p) => p.type === k).value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };
  const future = (offset) => local(new Date(Date.now() + offset * 86400000));
  const skillRow = (s = {}) =>
    /* HTML */ `<div class="edit-row skill-row">
      <label
        >Skill<input
          name="skill"
          value="${e(s.skill || "")}"
          placeholder="e.g. web design"
          maxlength="80"
          required /></label
      ><label
        >I want to<select name="kind">
          <option value="teach" ${s.kind === "teach" ? "selected" : ""}>
            Teach
          </option>
          <option value="learn" ${s.kind === "learn" ? "selected" : ""}>
            Learn
          </option>
        </select></label
      ><label
        >My teaching / requested level<select name="level">
          ${[1, 2, 3].map((n) => `<option value="${n}" ${s.level === n ? "selected" : ""}>${levels[n]}</option>`).join("")}
        </select></label
      ><button type="button" class="secondary small remove-row">Remove</button>
    </div>`;
  const availabilityRow = (a = {}) =>
    /* HTML */ `<div class="edit-row availability-row">
      <label
        >Day<select name="weekday">
          ${days.map((d, i) => `<option value="${i}" ${i === a.weekday ? "selected" : ""}>${d}</option>`).join("")}
        </select></label
      ><label
        >From<input
          type="time"
          name="start"
          value="${time(a.start_minute ?? 1080)}"
          required /></label
      ><label
        >Until (00:00 = next midnight)<input
          type="time"
          name="end"
          value="${a.end_minute === 1440 ? "00:00" : time(a.end_minute ?? 1200)}"
          required /></label
      ><button type="button" class="secondary small remove-row">Remove</button>
    </div>`;
  const sessionRow = (x, s = {}) =>
    /* HTML */ `<div class="edit-row session-row">
      <label
        >Student Mentor<select name="teacher_id">
          <option
            value="${x.requester_id}"
            ${s.teacher_id === x.requester_id ? "selected" : ""}
          >
            ${e(x.requester_name)} · ${e(x.requester_skill)}
          </option>
          <option
            value="${x.recipient_id}"
            ${s.teacher_id === x.recipient_id ? "selected" : ""}
          >
            ${e(x.recipient_name)} · ${e(x.recipient_skill)}
          </option>
        </select></label
      ><label
        >Starts at (Asia/Dhaka)<input
          type="datetime-local"
          name="starts_at"
          value="${s.starts_at ? local(s.starts_at) : future(2)}"
          required /></label
      ><label
        >Minutes<input
          type="number"
          name="duration_minutes"
          min="15"
          max="180"
          value="${s.ends_at ? Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000) : 60}"
          required /></label
      ><button type="button" class="secondary small remove-row">Remove</button>
    </div>`;
  let exchanges = [];
  async function preferences() {
    const d = await api("/exchange/preferences");
    return shell(
      "dashboard/preferences",
      /* HTML */ `<div class="eyebrow">WHAT YOU KNOW / WHAT COMES NEXT</div>
        <h1>Shape your skill exchange.</h1>
        <p>
          Use the same skill names as your potential partners. Matching checks
          complementary skills, proficiency, and at least 15 minutes of shared
          recurring availability.
        </p>
        <div class="panel">
          ${form(
            "preferences",
            /* HTML */ `<h2>Your skills</h2>
              <p>
                For teaching, choose your current proficiency. For learning,
                choose the level you want to learn.
              </p>
              <div id="skill-rows">
                ${(d.skills.length ? d.skills : [{ kind: "teach" }, { kind: "learn" }]).map(skillRow).join("")}
              </div>
              <button type="button" class="secondary small" id="add-skill">
                + Add skill
              </button>
              <h2 class="spaced">Recurring availability</h2>
              <p>
                All times are Asia/Dhaka. Use separate rows for different days.
                Agreements use specific dates, which both participants must
                accept.
              </p>
              <div id="availability-rows">
                ${(d.availability.length ? d.availability : [{}]).map(availabilityRow).join("")}
              </div>
              <button
                type="button"
                class="secondary small"
                id="add-availability"
              >
                + Add time window
              </button>
              <div class="note">
                These are preferences, not reserved times. Actual dates are
                checked for booking conflicts when the agreement is accepted.
              </div>`,
            "Save exchange preferences",
          )}
        </div>`,
    );
  }
  async function matches() {
    const d = await api("/exchange/matches");
    return shell(
      "dashboard/matches",
      /* HTML */ `<div class="section-heading">
          <div>
            <div class="eyebrow">RECIPROCAL LEARNING</div>
            <h1>Find your exchange partner.</h1>
          </div>
          <a href="#dashboard/preferences">Edit preferences →</a>
        </div>
        <p>
          ${e(d.method)} This is a rules-based matching system, not AI. A score
          ranks preference fit; it is not a measure of teaching quality.
        </p>
        <div class="grid">
          ${
            d.items
              .map(
                (m) =>
                  /* HTML */ `<article class="card">
                    <div class="mentor">
                      <span class="avatar"
                        >${e(
                          m.student.name
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join(""),
                        )}</span
                      >
                      <div>
                        <h3>${e(m.student.name)}</h3>
                        <small>${e(m.student.institution)}</small>
                      </div>
                    </div>
                    <span class="pill teal"
                      >Preference fit: ${m.score}/100</span
                    >
                    <h3>Why you match</h3>
                    <ul class="explanations">
                      ${m.explanations.map((t) => `<li>${e(t)}</li>`).join("")}
                    </ul>
                    ${form(
                      "request-" + m.student.id,
                      /* HTML */ `<label
                          >You teach<select name="requester_skill">
                            ${m.give.map((s) => `<option>${e(s)}</option>`).join("")}
                          </select></label
                        ><label
                          >You learn<select name="recipient_skill">
                            ${m.receive.map((s) => `<option>${e(s)}</option>`).join("")}
                          </select></label
                        ><label
                          >Introduce your exchange<textarea
                            name="message"
                            minlength="5"
                            maxlength="1000"
                            required
                            placeholder="What would you like to work on together?"
                          ></textarea>
                        </label>`,
                      "Send exchange request",
                    )}
                  </article>`,
              )
              .join("") ||
            '<div class="panel empty">No complementary matches yet. Add skills you can teach, skills you want to learn, and recurring availability. <a href="#dashboard/preferences">Update preferences →</a></div>'
          }
        </div>`,
    );
  }
  const action = (id, a, label) =>
    `<button type="button" class="${a === "accept" ? "" : "secondary"} small exchange-action" data-id="${id}" data-action="${a}">${label}</button>`;
  function exchangeCard(x) {
    const requester = user().id === x.requester_id;
    const counterpart = requester ? x.recipient_name : x.requester_name;
    const sideProgress = (teacher) => {
      const sessions = x.sessions.filter((s) => s.teacher_id === teacher);
      return `${sessions.filter((s) => s.teacher_completed && s.learner_confirmed).length}/${sessions.length}`;
    };
    return /* HTML */ `<article class="panel exchange-card">
      <div class="row">
        <div>
          <div class="eyebrow">EXCHANGE #${x.id} · REVISION ${x.revision}</div>
          <h2>${e(counterpart)}</h2>
          <p>
            ${e(x.requester_name)} teaches ${e(x.requester_skill)} ↔
            ${e(x.recipient_name)} teaches ${e(x.recipient_skill)}
          </p>
        </div>
        <span
          class="pill ${x.status === "active" || x.status === "completed" ? "teal" : ""}"
          >${e(x.status)}</span
        >
      </div>
      <p>${e(x.message)}</p>
      <p>
        <a href="#dashboard/room/exchange/${x.id}"
          >Open conversation & learning room →</a
        >
      </p>
      ${x.status === "active" ? '<p><a href="#dashboard/commitments">Request mutual cancellation →</a></p>' : ""}${
        x.status === "pending"
          ? /* HTML */ `<div class="actions">
                ${!requester ? action(x.id, "accept", "Accept request") + action(x.id, "reject", "Decline") : ""}${action(x.id, "cancel", "Cancel request")}
              </div>
              <small
                >Accepting a request starts negotiation. A scheduled agreement
                still needs acceptance from both students.</small
              >`
          : ""
      }${
        x.status === "negotiating"
          ? /* HTML */ `<p>
                Acceptance: ${e(x.requester_name)}
                ${x.requester_accepted ? "✓ accepted" : "— waiting"} ·
                ${e(x.recipient_name)}
                ${x.recipient_accepted ? "✓ accepted" : "— waiting"}
              </p>
              <details>
                <summary>Edit objectives & schedule</summary>
                ${form(
                  "agreement-" + x.id,
                  /* HTML */ `<input
                      type="hidden"
                      name="revision"
                      value="${x.revision}"
                    /><label
                      >What ${e(x.requester_name)} wants to learn
                      (${e(x.recipient_skill)})<textarea
                        name="requester_objective"
                        minlength="5"
                        maxlength="2000"
                        required
                      >
${e(x.requester_objective)}</textarea></label
                    ><label
                      >What ${e(x.recipient_name)} wants to learn
                      (${e(x.requester_skill)})<textarea
                        name="recipient_objective"
                        minlength="5"
                        maxlength="2000"
                        required
                      >
${e(x.recipient_objective)}</textarea>
                    </label>
                    <h3>Session schedule</h3>
                    <p>
                      Include at least one session taught by each student. All
                      dates use Asia/Dhaka.
                    </p>
                    <div class="session-rows">
                      ${(x.sessions.length
                        ? x.sessions
                        : [
                            {
                              teacher_id: x.requester_id,
                              starts_at: new Date(
                                Date.now() + 2 * 86400000,
                              ).toISOString(),
                            },
                            {
                              teacher_id: x.recipient_id,
                              starts_at: new Date(
                                Date.now() + 3 * 86400000,
                              ).toISOString(),
                            },
                          ]
                      )
                        .map((s) => sessionRow(x, s))
                        .join("")}
                    </div>
                    <button
                      type="button"
                      class="secondary small add-session"
                      data-id="${x.id}"
                    >
                      + Add session
                    </button>
                    <div class="note">
                      Saving changes creates a new revision and clears both
                      acceptances. Active objectives cannot be edited. Session
                      time changes require a separate reschedule accepted by
                      your partner.
                    </div>`,
                  "Save agreement revision",
                )}
              </details>
              <div class="actions spaced">
                ${x.revision > 0 && !(requester ? x.requester_accepted : x.recipient_accepted) ? `<button class="small accept-agreement" data-id="${x.id}" data-revision="${x.revision}">Accept revision ${x.revision}</button>` : ""}${action(x.id, "cancel", "Cancel exchange")}
              </div>`
          : ""
      }${
        x.revision
          ? /* HTML */ `<div class="two spaced">
                <div>
                  <h3>${e(x.requester_name)}'s learning objective</h3>
                  <p>${e(x.requester_objective)}</p>
                </div>
                <div>
                  <h3>${e(x.recipient_name)}'s learning objective</h3>
                  <p>${e(x.recipient_objective)}</p>
                </div>
              </div>
              <div class="note">
                Teaching delivered and confirmed: ${e(x.requester_name)}
                ${sideProgress(x.requester_id)} · ${e(x.recipient_name)}
                ${sideProgress(x.recipient_id)}. Both students must confirm each
                session.
              </div>
              <div>
                ${x.sessions
                  .map((s) => {
                    const teacher = s.teacher_id === user().id;
                    const done = teacher
                      ? s.teacher_completed
                      : s.learner_confirmed;
                    return /* HTML */ `<div class="row">
                      <div>
                        <strong
                          >${e(s.teacher_id === x.requester_id ? x.requester_name : x.recipient_name)}
                          teaches</strong
                        >
                        <p>
                          ${date(s.starts_at)} – ${date(s.ends_at)} · Asia/Dhaka
                        </p>
                        <small
                          >Mentor recorded:
                          ${s.teacher_completed ? "yes" : "no"} · Learner
                          confirmed:
                          ${s.learner_confirmed ? "yes" : "no"}</small
                        >
                      </div>
                      ${x.status === "active" && !done ? `<button class="small secondary complete-session" data-id="${x.id}" data-session="${s.id}" ${Date.parse(s.ends_at) > Date.now() || (!teacher && !s.teacher_completed) ? "disabled" : ""}>${teacher ? "Record completion" : "Confirm learning session"}</button>` : ""}
                    </div>`;
                  })
                  .join("")}
              </div>`
          : ""
      }${["active", "completed"].includes(x.status) ? `<details class="spaced"><summary>Report an unfulfilled agreement</summary>${x.reports.some((r) => r.reporter_id === user().id && r.status === "open") ? "<p>Your report is awaiting administrator review.</p>" : form("report-" + x.id, '<label>Describe the problem<textarea name="reason" minlength="10" maxlength="3000" required></textarea></label>', "Submit report")}<p>This records a complaint for review. No payment or refund is involved in a skill exchange.</p></details>` : ""}${
        x.reports.length
          ? /* HTML */ `<h3 class="spaced">Report history</h3>
              ${x.reports
                .map(
                  (r) =>
                    /* HTML */ `<div class="note">
                      <strong>${e(r.status)}</strong>
                      <p>${e(r.reason)}</p>
                      ${r.resolution ? /* HTML */ `<p>Administrator resolution: ${e(r.resolution)}</p>` : ""}
                    </div>`,
                )
                .join("")}`
          : ""
      }
    </article>`;
  }
  async function myExchanges() {
    const d = await api("/exchanges");
    exchanges = d.items;
    return shell(
      "dashboard/exchanges",
      /* HTML */ `<div class="section-heading">
          <div>
            <div class="eyebrow">SHARED COMMITMENT / SHARED PROGRESS</div>
            <h1>My exchanges</h1>
          </div>
          <a class="button" href="#dashboard/matches">Find a partner ↗</a>
        </div>
        <p>
          Requests, reciprocal agreements and exchange history. No money changes
          hands.
        </p>
        ${d.items.map(exchangeCard).join("") || '<div class="panel empty">No exchanges yet. Start by setting your skills and availability, then find a partner.</div>'}`,
    );
  }
  async function adminPage() {
    const d = await api("/admin/exchanges");
    return shell(
      "admin/exchanges",
      /* HTML */ `<h1>Exchange inspection</h1>
        <p>
          Inspect agreements and record resolutions for unfulfilled commitments.
        </p>
        ${
          d.items
            .map(
              (x) =>
                /* HTML */ `<div class="panel">
                  <h3>
                    #${x.id} · ${e(x.requester_name)} ↔ ${e(x.recipient_name)}
                    <span class="pill">${e(x.status)}</span>
                  </h3>
                  <p>
                    ${e(x.requester_skill)} / ${e(x.recipient_skill)} · Revision
                    ${x.revision}
                  </p>
                  <p>
                    ${e(x.requester_objective)} / ${e(x.recipient_objective)}
                  </p>
                  <p>
                    Accepted: ${x.requester_accepted ? "yes" : "no"} /
                    ${x.recipient_accepted ? "yes" : "no"}
                  </p>
                  ${can("exchanges.write") && ["pending", "negotiating", "active"].includes(x.status) ? form("terminate-exchange-" + x.id, '<label>Review decision reason<textarea name="reason" minlength="10" maxlength="3000" required></textarea></label>', "Terminate exchange after review") : ""}${d.sessions
                    .filter((s) => s.exchange_id === x.id)
                    .map(
                      (s) =>
                        /* HTML */ `<p>
                          ${date(s.starts_at)} · teacher #${s.teacher_id} ·
                          completion
                          ${s.teacher_completed ? "recorded" : "pending"} /
                          learner
                          ${s.learner_confirmed ? "confirmed" : "pending"}
                        </p>`,
                    )
                    .join("")}
                </div>`,
            )
            .join("") || '<div class="panel empty">No exchanges recorded.</div>'
        }
        <h2 class="spaced">Unfulfilled agreement reports</h2>
        ${
          d.reports
            .map(
              (r) =>
                /* HTML */ `<div class="panel">
                  <h3>
                    Report #${r.id} · Exchange #${r.exchange_id}
                    <span class="pill">${e(r.status)}</span>
                  </h3>
                  <p>${e(r.reason)}</p>
                  ${r.status === "open" && can("support.write") ? form("resolve-" + r.id, '<label>Resolution and reason<textarea name="reason" minlength="10" maxlength="3000" required></textarea></label>', "Record resolution") : /* HTML */ `<p>${e(r.resolution)}</p>`}
                </div>`,
            )
            .join("") || "<p>No reports.</p>"
        }`,
      true,
    );
  }
  async function render(route) {
    if (!user()) throw Error("Please sign in to use skill exchanges.");
    if (route === "dashboard/preferences") return preferences();
    if (route === "dashboard/matches") return matches();
    if (route === "admin/exchanges") return adminPage();
    return myExchanges();
  }
  async function rerender() {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  function wire() {
    document.querySelectorAll('[id^="terminate-exchange-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await api(
              "/admin/exchanges/" + f.id.split("-").pop() + "/terminate",
              "POST",
              b,
            )
          ).message,
        );
        await rerender();
      }),
    );
    $("#add-skill")?.addEventListener("click", () =>
      $("#skill-rows").insertAdjacentHTML("beforeend", skillRow()),
    );
    $("#add-availability")?.addEventListener("click", () =>
      $("#availability-rows").insertAdjacentHTML(
        "beforeend",
        availabilityRow(),
      ),
    );
    document.querySelectorAll(".add-session").forEach((b) =>
      b.addEventListener("click", () => {
        const x = exchanges.find((x) => x.id === Number(b.dataset.id));
        b.closest("form")
          .querySelector(".session-rows")
          .insertAdjacentHTML("beforeend", sessionRow(x));
      }),
    );
    $("#app").removeEventListener("click", removeHandler);
    $("#app").addEventListener("click", removeHandler);
    bind("preferences", async (b, f) => {
      const skills = [...f.querySelectorAll(".skill-row")].map((r) => ({
        skill: r.querySelector("[name=skill]").value,
        kind: r.querySelector("[name=kind]").value,
        level: Number(r.querySelector("[name=level]").value),
      }));
      const availability = [...f.querySelectorAll(".availability-row")].map(
        (r) => ({
          weekday: Number(r.querySelector("[name=weekday]").value),
          start_minute: minutes(r.querySelector("[name=start]").value),
          end_minute: minutes(r.querySelector("[name=end]").value) || 1440,
        }),
      );
      notice(
        (await api("/exchange/preferences", "PUT", { skills, availability }))
          .message,
      );
    });
    document.querySelectorAll('[id^="request-"]').forEach((f) =>
      bind(f.id, async (b) => {
        await api("/exchanges", "POST", {
          ...b,
          recipient_id: Number(f.id.split("-")[1]),
        });
        notice("Exchange request sent.");
        location.hash = "dashboard/exchanges";
      }),
    );
    document.querySelectorAll(".exchange-action").forEach((b) =>
      b.addEventListener("click", () =>
        buttonRun(b, () =>
          api("/exchanges/" + b.dataset.id + "/respond", "POST", {
            action: b.dataset.action,
          }),
        ),
      ),
    );
    document.querySelectorAll(".accept-agreement").forEach((b) =>
      b.addEventListener("click", () =>
        buttonRun(b, () =>
          api("/exchanges/" + b.dataset.id + "/accept-agreement", "POST", {
            revision: Number(b.dataset.revision),
          }),
        ),
      ),
    );
    document
      .querySelectorAll(".complete-session")
      .forEach((b) =>
        b.addEventListener("click", () =>
          buttonRun(b, () =>
            api(
              "/exchanges/" +
                b.dataset.id +
                "/sessions/" +
                b.dataset.session +
                "/complete",
              "POST",
              {},
            ),
          ),
        ),
      );
    document.querySelectorAll('[id^="agreement-"]').forEach((f) =>
      bind(f.id, async (b, f) => {
        const sessions = [...f.querySelectorAll(".session-row")].map((r) => ({
          teacher_id: Number(r.querySelector("[name=teacher_id]").value),
          starts_at: new Date(
            r.querySelector("[name=starts_at]").value + ":00+06:00",
          ).toISOString(),
          duration_minutes: Number(
            r.querySelector("[name=duration_minutes]").value,
          ),
        }));
        const result = await api(
          "/exchanges/" + f.id.split("-")[1] + "/agreement",
          "PUT",
          {
            revision: Number(b.revision),
            requester_objective: b.requester_objective,
            recipient_objective: b.recipient_objective,
            sessions,
          },
        );
        notice(result.message);
        await rerender();
      }),
    );
    document.querySelectorAll('[id^="report-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await api(
              "/exchanges/" + f.id.split("-")[1] + "/reports",
              "POST",
              b,
            )
          ).message,
        );
        await rerender();
      }),
    );
    document.querySelectorAll('[id^="resolve-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await api(
              "/admin/exchange-reports/" + f.id.split("-")[1] + "/resolve",
              "POST",
              b,
            )
          ).message,
        );
        await rerender();
      }),
    );
  }
  // Delegation survives added rows and is installed once on the stable application root.
  function removeHandler(ev) {
    if (ev.target.closest(".remove-row"))
      ev.target.closest(".edit-row").remove();
  }
  async function buttonRun(b, run) {
    b.disabled = true;
    try {
      notice((await run()).message);
      await rerender();
    } catch (err) {
      notice(err.message);
    } finally {
      b.disabled = false;
    }
  }
  const $ = (q) => document.querySelector(q);
  return { render, wire };
}
