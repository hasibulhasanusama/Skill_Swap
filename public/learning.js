export function createLearningUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  user,
  shell,
}) {
  const $ = (q) => document.querySelector(q);
  let room = null,
    messagePage = null,
    messages = [],
    hasMore = false;
  const drafts = new Map();
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
    const value = (k) => parts.find((p) => p.type === k).value;
    return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
  };
  const reload = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const callButton = (b, run) => {
    b.disabled = true;
    Promise.resolve()
      .then(run)
      .then((r) => {
        notice(r.message);
        reload();
      })
      .catch((err) => notice(err.message))
      .finally(() => (b.disabled = false));
  };
  const label = (id) =>
    e(room.participants.find((p) => p.id === id)?.name || "Student");
  async function inbox() {
    const { items } = await api("/learning/contexts");
    return shell(
      "dashboard/messages",
      /* HTML */ `<div class="section-heading">
          <div>
            <div class="eyebrow">KEEP THE CONVERSATION MOVING</div>
            <h1>Messages & learning rooms</h1>
          </div>
          <button class="secondary small refresh-room">Refresh</button>
        </div>
        <p>
          Private conversations and materials for your bookings and skill
          exchanges. ${items.reduce((n, x) => n + x.unread, 0)} unread messages.
        </p>
        <div class="panel">
          ${
            items
              .map(
                (c) =>
                  /* HTML */ `<a
                    class="room-link"
                    href="#dashboard/room/${c.kind}/${c.id}"
                    ><span class="avatar"
                      >${e(
                        c.counterpart
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join(""),
                      )}</span
                    >
                    <div>
                      <strong>${e(c.title)}</strong>
                      <p>
                        ${e(c.counterpart)} ·
                        ${c.kind === "booking" ? "Session reservation" : "Skill exchange"}
                        #${c.id}
                      </p>
                      <span class="pill"
                        >${e(c.learning_status || c.status)}</span
                      >
                    </div>
                    ${c.unread ? /* HTML */ `<span class="unread-badge">${c.unread} unread</span>` : '<span class="muted">Open room →</span>'}</a
                  >`,
              )
              .join("") ||
            '<div class="empty">No conversations yet. Book a session or send an exchange request to start.</div>'
          }
        </div>`,
    );
  }
  function sessionCard(s) {
    const kind = s.session_kind,
      teacher = s.teacher_id === user().id;
    const pending = room.reschedules.find(
      (r) =>
        r.status === "pending" &&
        r[kind === "booking" ? "booking_id" : "exchange_session_id"] === s.id,
    );
    const ownAttendance = room.attendance.find(
      (a) =>
        a.user_id === user().id &&
        a[kind === "booking" ? "booking_id" : "exchange_session_id"] === s.id,
    );
    const started = Date.parse(s.starts_at) <= Date.now(),
      ended = Date.parse(s.ends_at) <= Date.now();
    const editable =
      room.writable &&
      (kind === "booking"
        ? s.learning_status === "scheduled"
        : room.record.status === "active" &&
          !s.teacher_completed &&
          !s.learner_confirmed);
    const paymentBlocked =
      kind === "booking" &&
      room.record.payment_required &&
      (!room.allocation ||
        room.allocation.on_hold ||
        room.allocation.status === "refunded");
    const complete =
      kind === "booking"
        ? s.learning_status === "completed"
        : s.teacher_completed && s.learner_confirmed;
    return /* HTML */ `<section class="panel session-panel">
      <div class="row">
        <div>
          <h3>${label(s.teacher_id)} teaches · Session #${s.id}</h3>
          <p>${date(s.starts_at)} — ${date(s.ends_at)} · Asia/Dhaka</p>
        </div>
        <span class="pill ${complete ? "teal" : ""}"
          >${complete ? "Completed" : kind === "booking" ? e(s.learning_status) : "Exchange session"}</span
        >
      </div>
      ${s.meeting_url ? /* HTML */ `<a class="button secondary small" href="${e(s.meeting_url)}" target="_blank" rel="noopener noreferrer">Open external meeting ↗</a>` : "<p>No meeting link saved yet.</p>"}
      <p class="muted">
        External meeting service. Opening the link does not record attendance.
      </p>
      ${teacher && editable ? `<details><summary>Manage meeting link</summary>${form("meeting-" + kind + "-" + s.id, /* HTML */ `<label>HTTPS meeting URL (leave blank to remove)<input type="url" name="meeting_url" value="${e(s.meeting_url)}" placeholder="https://meet.example.com/your-room" /></label>`, "Save meeting link")}</details>` : ""}
      ${
        editable && !started && !pending
          ? `<details class="spaced"><summary>Propose a different time</summary>${form(
              "reschedule-" + kind + "-" + s.id,
              /* HTML */ `<label
                  >New start (Asia/Dhaka)<input
                    type="datetime-local"
                    name="starts_at"
                    value="${local(new Date(Date.parse(s.starts_at) + 86400000))}"
                    required /></label
                ><label
                  >Reason<textarea
                    name="reason"
                    minlength="5"
                    maxlength="1000"
                    required
                  ></textarea>
                </label>
                <p>
                  Duration stays the same. The original time remains reserved
                  until your partner accepts.
                </p>`,
              "Send reschedule proposal",
            )}</details>`
          : ""
      }
      ${
        pending
          ? /* HTML */ `<div class="note">
              <strong>Reschedule awaiting response</strong>
              <p>
                ${date(pending.proposed_starts_at)} —
                ${date(pending.proposed_ends_at)} · Asia/Dhaka
              </p>
              <p>${e(pending.reason)}</p>
              <div class="actions">
                ${pending.proposer_id === user().id ? `<button class="secondary small reschedule-response" data-id="${pending.id}" data-action="cancel">Cancel proposal</button>` : `<button class="small reschedule-response" data-id="${pending.id}" data-action="accept">Accept new time</button><button class="secondary small reschedule-response" data-id="${pending.id}" data-action="reject">Keep original time</button>`}
              </div>
            </div>`
          : ""
      }
      ${
        started &&
        (room.record.status === "reserved" ||
          ["active", "completed"].includes(room.record.status))
          ? `<details class="spaced"><summary>Your self-reported attendance${ownAttendance ? " · " + e(ownAttendance.status) : ""}</summary>${form(
              "attendance-" + kind + "-" + s.id,
              /* HTML */ `<label
                  >Attendance<select name="status">
                    <option
                      value="present"
                      ${ownAttendance?.status === "present" ? "selected" : ""}
                    >
                      I was present
                    </option>
                    <option
                      value="absent"
                      ${ownAttendance?.status === "absent" ? "selected" : ""}
                    >
                      I was absent
                    </option>
                  </select></label
                ><label
                  >Note (optional)<textarea name="note" maxlength="500">
${e(ownAttendance?.note)}</textarea>
                </label>`,
              "Save my attendance",
            )}<p>This is a participant statement, not independently verified attendance.</p></details>`
          : ""
      }
      <div class="spaced">
        ${
          kind === "booking"
            ? /* HTML */ `<p>
                  Confirming delivery releases eligible simulated earnings. If
                  there is a problem,
                  <a href="#dashboard/disputes">open a payment complaint</a>
                  before confirming.
                </p>
                <p>
                  Mentor delivery:
                  ${s.mentor_completed_at ? date(s.mentor_completed_at) : "Not recorded"}<br />Learner
                  confirmation:
                  ${s.learner_confirmed_at ? date(s.learner_confirmed_at) : "Waiting"}
                </p>
                ${s.confirmation_due_at ? /* HTML */ `<p>Response requested by ${date(s.confirmation_due_at)} · Asia/Dhaka. Expiry does not confirm delivery or release an allocation.</p>` : ""}${!paymentBlocked && ended && room.record.status === "reserved" && ((teacher && s.learning_status === "scheduled") || (!teacher && s.learning_status === "completion_pending")) ? `<button class="small booking-completion" data-id="${s.id}" data-action="${teacher ? "complete" : "confirm"}">${teacher ? "Record session delivery" : "Confirm session delivered"}</button>` : ""}`
            : /* HTML */ `<p>
                  Mentor recorded: ${s.teacher_completed ? "yes" : "no"} ·
                  Learner confirmed: ${s.learner_confirmed ? "yes" : "no"}
                </p>
                ${ended && room.record.status === "active" && ((teacher && !s.teacher_completed) || (!teacher && s.teacher_completed && !s.learner_confirmed)) ? `<button class="small exchange-completion" data-id="${s.id}">${teacher ? "Record session delivery" : "Confirm learning session"}</button>` : ""}`
        }
      </div>
    </section>`;
  }
  function messageHTML() {
    return (
      messages
        .map(
          (m) =>
            /* HTML */ `<article
              class="message ${m.sender_id === user().id ? "own" : ""}"
            >
              <div>
                <strong>${e(m.sender_name || label(m.sender_id))}</strong
                ><time>${date(m.created_at)}</time>
              </div>
              <p>${e(m.body)}</p>
            </article>`,
        )
        .join("") ||
      '<p class="empty">No messages yet. Introduce what you would like to work on.</p>'
    );
  }
  async function learningRoom(kind, id) {
    room = await api(`/learning/${kind}/${id}`);
    const data = await api(`/learning/${kind}/${id}/messages`);
    messages = data.items;
    hasMore = data.has_more;
    messagePage = `/learning/${kind}/${id}`;
    const title =
      kind === "booking" ? "Session learning room" : "Exchange learning room";
    return shell(
      "dashboard/messages",
      /* HTML */ `<a href="#dashboard/messages">← All conversations</a>
        <div class="section-heading">
          <div>
            <div class="eyebrow">PRIVATE / ${e(kind.toUpperCase())} #${id}</div>
            <h1>${title}</h1>
            <p>
              ${room.participants.map((p) => e(p.name)).join(" & ")} ·
              ${e(room.record.status)}
            </p>
          </div>
          <button class="secondary small refresh-room">Refresh room</button>
        </div>
        ${
          kind === "booking" && room.record.payment_required
            ? /* HTML */ `<div class="note">
                <strong
                  >Sandbox payment
                  ${room.allocation ? e(room.allocation.status) + (room.allocation.on_hold ? " · dispute hold" : "") : "required"}</strong
                >
                <p>
                  No real money is charged. Mentor completion alone never
                  releases an allocation.
                </p>
                ${user().id === room.record.learner_id ? /* HTML */ `<a href="#checkout/${id}">Sandbox checkout / receipt →</a>` : ""}
                · <a href="#dashboard/disputes">Payment complaints</a>
              </div>`
            : ""
        }
        <p>
          <a href="#dashboard/projects?kind=${kind}&id=${id}"
            >Exercises, project submissions & feedback →</a
          >
          ·
          <a href="#dashboard/reviews">Review eligible completed learning →</a>
          · <a href="#dashboard/commitments">Cancellation options →</a>
        </p>
        <div class="learning-layout">
          <section>
            <h2>Sessions & agreements</h2>
            ${room.sessions.map(sessionCard).join("") || '<div class="panel empty">Agree on a schedule in <a href="#dashboard/exchanges">My exchanges</a> before sessions appear here.</div>'}${kind === "exchange" ? '<p><a href="#dashboard/exchanges">View exchange objectives, acceptance and reports →</a></p>' : ""}
            <h2 class="spaced">Private learning materials</h2>
            <div class="panel">
              ${
                room.materials
                  .map(
                    (m) =>
                      /* HTML */ `<div class="row">
                        <div>
                          <strong>${e(m.title)}</strong>
                          <p>
                            ${e(m.uploader_name)} ·
                            ${Math.ceil(m.size_bytes / 1024)} KB
                          </p>
                        </div>
                        <a
                          href="/api/files/${m.file_id}"
                          class="button secondary small"
                          >Download ${e(m.original_name)}</a
                        >
                      </div>`,
                  )
                  .join("") || "<p>No materials shared yet.</p>"
              }${room.writable && (kind === "booking" || room.record.status === "active") ? form("material-upload", '<label>Material title<input name="title" minlength="2" maxlength="120" required></label><label>File (PDF, PNG, JPEG, TXT, MD; max 5 MB)<input name="material" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.md" required></label>', "Share private material") : ""}
            </div>
            ${
              room.reschedules.length
                ? `<details class="spaced"><summary>Reschedule history (${room.reschedules.length})</summary>${room.reschedules
                    .map(
                      (r) =>
                        /* HTML */ `<div class="row">
                          <div>
                            <strong>${e(r.status)}</strong>
                            <p>
                              ${date(r.original_starts_at)} →
                              ${date(r.proposed_starts_at)} · Asia/Dhaka
                            </p>
                            <p>${e(r.reason)}</p>
                          </div>
                        </div>`,
                    )
                    .join("")}</details>`
                : ""
            }
          </section>
          <section class="panel chat-panel">
            <div class="section-heading">
              <h2>Conversation</h2>
              <span class="pill">Participants only</span>
            </div>
            <p>
              Refresh to check for new messages. Messages and materials stay
              private to this learning room.
            </p>
            <button
              id="older-messages"
              class="secondary small"
              ${hasMore ? "" : "hidden"}
            >
              Load older messages
            </button>
            <div id="message-list" class="message-list" aria-live="polite">
              ${messageHTML()}
            </div>
            ${room.writable ? form("send-message", '<label>Message<textarea name="body" maxlength="4000" required placeholder="Ask a question or share your next step…"></textarea></label>', "Send message") : '<div class="note">This room is read-only. You can still view your conversation and materials.</div>'}
          </section>
        </div>`,
    );
  }
  async function notifications() {
    const d = await api("/notifications");
    return shell(
      "dashboard/notifications",
      /* HTML */ `<div class="section-heading">
          <div>
            <div class="eyebrow">YOUR NEXT ACTION</div>
            <h1>Notifications</h1>
          </div>
          <button class="secondary small refresh-room">Refresh</button>
        </div>
        <p>
          ${d.unread} unread notifications. In-app updates only; email and push
          delivery are not configured.
        </p>
        <h2>Coming up in 24 hours</h2>
        <div class="panel">
          ${
            d.upcoming
              .map(
                (s) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong
                        >${s.kind === "booking" ? "Booked session" : "Exchange session"}
                        #${s.id}</strong
                      >
                      <p>${date(s.starts_at)} · Asia/Dhaka</p>
                    </div>
                    <a class="button secondary small" href="#${e(s.route)}"
                      >Open room</a
                    >
                  </div>`,
              )
              .join("") || "<p>No upcoming sessions in the next 24 hours.</p>"
          }
        </div>
        <h2 class="spaced">Activity</h2>
        <div class="panel">
          ${
            d.items
              .map(
                (n) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong>${e(n.title)}</strong>
                      <p>${date(n.created_at)} · Asia/Dhaka</p>
                      <a href="#${e(n.route)}">View details →</a>
                    </div>
                    ${n.read_at ? '<span class="pill">Read</span>' : `<button class="small secondary notification-read" data-id="${n.id}">Mark read</button>`}
                  </div>`,
              )
              .join("") || "<p>No activity notifications yet.</p>"
          }
        </div>`,
    );
  }
  async function inspection() {
    const d = await api("/admin/learning-sessions");
    return shell(
      "admin/learning",
      /* HTML */ `<h1>Session inspection</h1>
        <p>
          Booking delivery, participant-reported attendance and reschedule
          audit. This page does not expose private conversations.
        </p>
        <div class="panel">
          ${
            d.bookings
              .map(
                (b) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong>Booking #${b.id}: ${e(b.title)}</strong>
                      <p>
                        ${date(b.starts_at)} · ${e(b.learning_status)} · learner
                        #${b.learner_id}, mentor #${b.mentor_id}
                      </p>
                      <small
                        >Delivery
                        ${b.mentor_completed_at ? "recorded" : "pending"} /
                        learner
                        ${b.learner_confirmed_at ? "confirmed" : "pending"}</small
                      >
                    </div>
                  </div>`,
              )
              .join("") || "<p>No bookings yet.</p>"
          }
        </div>
        <h2 class="spaced">Self-reported attendance</h2>
        <div class="panel">
          ${
            d.attendance
              .map(
                (a) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong
                        >${a.booking_id ? "Booking #" + a.booking_id : "Exchange session #" + a.exchange_session_id}
                        · student #${a.user_id}</strong
                      >
                      <p>${e(a.status)} · ${e(a.note)}</p>
                    </div>
                  </div>`,
              )
              .join("") || "<p>No attendance statements yet.</p>"
          }
        </div>
        <h2 class="spaced">Reschedule history</h2>
        <div class="panel">
          ${
            d.reschedules
              .map(
                (r) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong>Proposal #${r.id} · ${e(r.status)}</strong>
                      <p>
                        ${date(r.original_starts_at)} →
                        ${date(r.proposed_starts_at)}
                      </p>
                      <p>${e(r.reason)}</p>
                    </div>
                  </div>`,
              )
              .join("") || "<p>No reschedules yet.</p>"
          }
        </div>`,
      true,
    );
  }
  async function render(route) {
    room = null;
    messagePage = null;
    if (route === "dashboard/messages") return inbox();
    if (route === "dashboard/notifications") return notifications();
    if (route === "admin/learning") return inspection();
    const [, , kind, id] = route.split("/");
    return learningRoom(kind, Number(id));
  }
  function wire() {
    document
      .querySelectorAll(".refresh-room")
      .forEach((b) => b.addEventListener("click", reload));
    bind("send-message", async (b, f) => {
      const body = b.body.trim();
      let draft = drafts.get(messagePage);
      if (!draft || draft.body !== body) {
        draft = { body, client_key: crypto.randomUUID() };
        drafts.set(messagePage, draft);
      }
      await api(messagePage + "/messages", "POST", draft);
      drafts.delete(messagePage);
      f.reset();
      notice("Message sent.");
      reload();
    });
    bind("material-upload", async (b, f) => {
      notice(
        (await api(messagePage + "/materials", "POST", new FormData(f)))
          .message,
      );
      reload();
    });
    document.querySelectorAll('[id^="meeting-"]').forEach((f) =>
      bind(f.id, async (b) => {
        const parts = f.id.split("-"),
          id = parts.pop(),
          kind = parts.slice(1).join("-");
        notice(
          (await api(`/learning-sessions/${kind}/${id}/meeting`, "PUT", b))
            .message,
        );
        reload();
      }),
    );
    document.querySelectorAll('[id^="attendance-"]').forEach((f) =>
      bind(f.id, async (b) => {
        const parts = f.id.split("-"),
          id = parts.pop(),
          kind = parts.slice(1).join("-");
        notice(
          (await api(`/learning-sessions/${kind}/${id}/attendance`, "POST", b))
            .message,
        );
        reload();
      }),
    );
    document.querySelectorAll('[id^="reschedule-"]').forEach((f) =>
      bind(f.id, async (b) => {
        const parts = f.id.split("-"),
          id = parts.pop(),
          kind = parts.slice(1).join("-");
        notice(
          (
            await api(`/learning-sessions/${kind}/${id}/reschedules`, "POST", {
              reason: b.reason,
              starts_at: new Date(b.starts_at + ":00+06:00").toISOString(),
            })
          ).message,
        );
        reload();
      }),
    );
    document.querySelectorAll(".reschedule-response").forEach((b) =>
      b.addEventListener("click", () =>
        callButton(b, () =>
          api(`/reschedules/${b.dataset.id}/respond`, "POST", {
            action: b.dataset.action,
          }),
        ),
      ),
    );
    document
      .querySelectorAll(".booking-completion")
      .forEach((b) =>
        b.addEventListener("click", () =>
          callButton(b, () =>
            api(`/bookings/${b.dataset.id}/${b.dataset.action}`, "POST", {}),
          ),
        ),
      );
    document
      .querySelectorAll(".exchange-completion")
      .forEach((b) =>
        b.addEventListener("click", () =>
          callButton(b, () =>
            api(
              `/exchanges/${room.id}/sessions/${b.dataset.id}/complete`,
              "POST",
              {},
            ),
          ),
        ),
      );
    document
      .querySelectorAll(".notification-read")
      .forEach((b) =>
        b.addEventListener("click", () =>
          callButton(b, () =>
            api(`/notifications/${b.dataset.id}/read`, "POST", {}),
          ),
        ),
      );
    $("#older-messages")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      try {
        const d = await api(messagePage + "/messages?before=" + messages[0].id);
        messages = [...d.items, ...messages];
        hasMore = d.has_more;
        $("#message-list").innerHTML = messageHTML();
        b.hidden = !hasMore;
      } catch (err) {
        notice(err.message);
      } finally {
        b.disabled = false;
      }
    });
    if (messagePage && messages.length)
      api(messagePage + "/read", "POST", {
        through_id: messages[messages.length - 1].id,
      }).catch((err) => notice(err.message));
  }
  return { render, wire };
}
