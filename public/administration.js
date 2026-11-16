export function createAdministrationUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  money,
  user,
  shell,
  refreshUser,
  onSignedOut,
}) {
  const can = (p) =>
    user()?.permissions?.includes("*") || user()?.permissions?.includes(p);
  const reload = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const why =
    '<label>Recorded reason<textarea name="reason" minlength="10" maxlength="3000" required></textarea></label>';
  const checkbox = (name, label, value) =>
    /* HTML */ `<label
      ><input type="checkbox" name="${name}" ${value ? "checked" : ""} />
      ${label}</label
    >`;
  const keys = new Map();
  let report = null;
  async function users() {
    const q = new URLSearchParams(location.hash.split("?")[1] || "");
    const d = await api("/admin/users?" + q);
    return shell(
      "admin/users",
      /* HTML */ `<h1>Student accounts</h1>
        <p>
          Search enrolled student accounts. Administrator accounts are managed
          separately.
        </p>
        ${form(
          "student-search",
          /* HTML */ `<div class="filters">
            <label
              >Name, email or institution<input
                name="q"
                value="${e(q.get("q") || "")}" /></label
            ><label
              >Verification<select name="verification">
                <option value="">All statuses</option>
                ${["unverified", "pending", "approved", "rejected"].map((v) => `<option ${q.get("verification") === v ? "selected" : ""}>${v}</option>`).join("")}
              </select></label
            ><label
              >Account state<select name="suspended">
                <option value="">All accounts</option>
                <option
                  value="false"
                  ${q.get("suspended") === "false" ? "selected" : ""}
                >
                  Active
                </option>
                <option
                  value="true"
                  ${q.get("suspended") === "true" ? "selected" : ""}
                >
                  Suspended/deactivated
                </option>
              </select></label
            >
          </div>`,
          "Search students",
        )}
        <p>
          ${d.total} matching student accounts · Page ${d.page} of
          ${Math.max(1, d.pages)}
        </p>
        ${
          d.items
            .map(
              (u) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>
                    ${e(u.name)}
                    <span class="pill"
                      >${u.suspended ? "Suspended" : "Active"} ·
                      ${e(u.verification)}</span
                    >
                  </h3>
                  <p>${e(u.email)} · ${e(u.institution)}</p>
                  ${u.suspension_reason ? /* HTML */ `<p>Last status reason: ${e(u.suspension_reason)}</p>` : ""}${
                    can("users.write")
                      ? form(
                          "student-status-" + u.id,
                          /* HTML */ `<label
                              >Account access<select name="suspended">
                                <option
                                  value="false"
                                  ${!u.suspended ? "selected" : ""}
                                >
                                  Restore / keep active
                                </option>
                                <option
                                  value="true"
                                  ${u.suspended ? "selected" : ""}
                                >
                                  Suspend access
                                </option>
                              </select></label
                            >${why}`,
                          "Record account status",
                        )
                      : ""
                  }
                </section>`,
            )
            .join("") || '<div class="panel empty">No matching accounts.</div>'
        }
        <div class="pagination">
          <button
            class="secondary student-page"
            data-page="${d.page - 1}"
            ${d.page <= 1 ? "disabled" : ""}
          >
            Previous</button
          ><button
            class="secondary student-page"
            data-page="${d.page + 1}"
            ${d.page >= d.pages ? "disabled" : ""}
          >
            Next
          </button>
        </div>`,
      true,
    );
  }
  async function categories() {
    const d = await api("/admin/categories");
    return shell(
      "admin/categories",
      /* HTML */ `<h1>Skill categories</h1>
        <p>
          Archiving hides the category and its listings from new public
          discovery. Existing session history is retained.
        </p>
        ${can("categories.write") ? `<details class="panel"><summary>Add category</summary>${form("category-new", '<label>Name<input name="name" minlength="2" maxlength="120" required></label>' + why, "Create category")}</details>` : ""}${d.items
          .map(
            (c) =>
              /* HTML */ `<section class="panel exchange-card">
                <h3>${e(c.name)} · ${c.active ? "Active" : "Archived"}</h3>
                <p>${c.listing_count} stored listings</p>
                ${can("categories.write") ? form("category-edit-" + c.id, /* HTML */ `<label>Name<input name="name" value="${e(c.name)}" minlength="2" maxlength="120" required /></label>${checkbox("active", "Available for new listings and discovery", c.active)}${why}`, "Save category") : ""}
              </section>`,
          )
          .join("")}`,
      true,
    );
  }
  async function listings() {
    const q =
        new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "",
      d = await api("/admin/listings?q=" + encodeURIComponent(q));
    return shell(
      "admin/listings",
      /* HTML */ `<h1>Listing moderation</h1>
        <p>
          Latest 200 matching listings. Restoring respects owner publication
          status, category state and mentor eligibility.
        </p>
        ${form("listing-search", /* HTML */ `<label>Title or Student Mentor<input name="q" value="${e(q)}" /></label>`, "Find listings")}${
          d.items
            .map(
              (l) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>${e(l.title)}</h3>
                  <p>
                    ${e(l.mentor_name)} · ${e(l.category)} ·
                    ${l.category_active ? "active category" : "archived category"}
                  </p>
                  <p class="preserve-lines">${e(l.description)}</p>
                  <span class="pill"
                    >${e(l.status)} · ${e(l.moderation_status)}</span
                  >${l.moderation_reason ? /* HTML */ `<p>${e(l.moderation_reason)}</p>` : ""}${
                    can("listings.write")
                      ? form(
                          "listing-moderation-" + l.id,
                          /* HTML */ `<label
                              >Public moderation<select name="status">
                                <option
                                  value="visible"
                                  ${l.moderation_status === "visible" ? "selected" : ""}
                                >
                                  Visible if otherwise eligible
                                </option>
                                <option
                                  value="hidden"
                                  ${l.moderation_status === "hidden" ? "selected" : ""}
                                >
                                  Hidden from new public access
                                </option>
                              </select></label
                            >${why}`,
                          "Record listing decision",
                        )
                      : ""
                  }
                </section>`,
            )
            .join("") || '<div class="panel empty">No listings found.</div>'
        }`,
      true,
    );
  }
  async function policies(admin = false) {
    const d = await api(admin ? "/admin/policies" : "/policies"),
      p = d.policy;
    const text = /* HTML */ `<div class="eyebrow">
        PLATFORM RULES / REVISION ${p.revision}
      </div>
      <h1>${admin ? "Policy settings" : "Platform policies"}</h1>
      <div class="note">
        <strong>Sandbox transactions only.</strong> No real money, real escrow
        or native video conferencing.
      </div>
      <div class="panel">
        <p class="preserve-lines">${e(p.policy_text)}</p>
        <p>
          New payment commission: ${(p.commission_bps / 100).toFixed(2)}%
          included in the session price.
        </p>
        <p>
          Learner paid cancellation notice: ${p.cancellation_notice_hours}
          hours. Mentor cancellation before start provides a full remaining
          simulated refund.
        </p>
        <p>
          Delivery response deadline: ${p.completion_response_hours} hours;
          expiry does not automatically confirm delivery or release payment.
        </p>
        <p>
          Registration ${p.registration_open ? "open" : "paused"} · Listing
          publication ${p.listing_publication_open ? "open" : "paused"}.
        </p>
      </div>
      ${
        admin && can("policies.write")
          ? /* HTML */ `<section class="panel spaced">
              <h2>Save a new policy revision</h2>
              ${form(
                "policy-edit",
                /* HTML */ `<input
                    type="hidden"
                    name="revision"
                    value="${p.revision}"
                  /><label
                    >Platform commission (%)<input
                      type="number"
                      name="commission_percent"
                      min="0"
                      max="100"
                      step="0.01"
                      value="${p.commission_bps / 100}"
                      required /></label
                  ><label
                    >Response deadline (hours)<input
                      type="number"
                      name="completion_response_hours"
                      min="1"
                      max="720"
                      value="${p.completion_response_hours}"
                      required /></label
                  ><label
                    >Paid learner cancellation notice (hours)<input
                      type="number"
                      name="cancellation_notice_hours"
                      min="0"
                      max="168"
                      value="${p.cancellation_notice_hours}"
                      required /></label
                  >${checkbox("registration_open", "Allow new student registrations", p.registration_open)}${checkbox("listing_publication_open", "Allow listing publication/updates", p.listing_publication_open)}<label
                    >Published policy text<textarea
                      name="policy_text"
                      minlength="20"
                      maxlength="10000"
                      required
                    >
${e(p.policy_text)}</textarea>
                  </label>
                  <p>
                    Existing booking deadlines/cancellation windows and funded
                    commission snapshots are retained.
                  </p>
                  ${why}`,
                "Save policy revision",
              )}
            </section>`
          : ""
      }`;
    return admin
      ? shell("admin/policies", text, true)
      : /* HTML */ `<div class="intro">
          ${text}
          <p>
            <a href="#dashboard/commitments"
              >Manage booking/exchange commitments →</a
            >
          </p>
        </div>`;
  }
  const announcementFields = (a) =>
    /* HTML */ `<label
        >Title<input
          name="title"
          value="${e(a?.title || "")}"
          minlength="2"
          maxlength="120"
          required /></label
      ><label
        >Announcement<textarea
          name="body"
          minlength="10"
          maxlength="6000"
          required
        >
${e(a?.body || "")}</textarea></label
      ><label
        >Audience<select name="audience">
          <option
            value="public"
            ${a?.audience !== "students" ? "selected" : ""}
          >
            Public website
          </option>
          <option
            value="students"
            ${a?.audience === "students" ? "selected" : ""}
          >
            Signed-in students
          </option>
        </select></label
      >${checkbox("published", "Publish in the selected in-app audience", a?.published)}${why}`;
  async function announcements(admin = false) {
    const d = await api(admin ? "/admin/announcements" : "/announcements");
    const html = /* HTML */ `<div class="eyebrow">PLATFORM UPDATES</div>
      <h1>${admin ? "Manage announcements" : "Announcements"}</h1>
      ${admin && can("announcements.write") ? `<details class="panel"><summary>Create announcement</summary>${form("announcement-new", announcementFields(), "Save announcement")}</details>` : ""}${
        d.items
          .map(
            (a) =>
              /* HTML */ `<section class="panel exchange-card">
                <h2>${e(a.title)}</h2>
                <p class="preserve-lines">${e(a.body)}</p>
                <small
                  >${date(a.created_at)} ·
                  ${e(a.audience)}${admin ? " · " + (a.published ? "published" : "draft") : ""}</small
                >${admin && can("announcements.write") ? `<details class="spaced"><summary>Edit announcement</summary>${form("announcement-edit-" + a.id, announcementFields(a), "Save announcement")}</details>` : ""}
              </section>`,
          )
          .join("") ||
        '<div class="panel empty">No announcements for this audience yet.</div>'
      }`;
    return admin
      ? shell("admin/announcements", html, true)
      : /* HTML */ `<div class="intro">${html}</div>`;
  }
  async function account() {
    const d = await api("/account/settings"),
      s = d.settings;
    return shell(
      "dashboard/account",
      /* HTML */ `<h1>Account & privacy</h1>
        <div class="two">
          <section class="panel">
            <h2>Privacy and in-app notifications</h2>
            ${form("account-settings", `${user().role === "student" ? checkbox("profile_public", "Show my public profile and published portfolio", s.profile_public) : ""}<p>Hiding your profile also hides public portfolio downloads. Published listings and reviews may still display your student name.</p>${checkbox("activity", "Show in-app activity notifications", s.notifications.activity)}${checkbox("session_reminders", "Show upcoming-session reminders in the app", s.notifications.session_reminders)}<p>These settings do not enable external email or push delivery.</p>`, "Save preferences")}
          </section>
          <section class="panel">
            <h2>Change password</h2>
            ${form("change-password", '<label>Current password<input type="password" name="current_password" autocomplete="current-password" required></label><label>New password (at least 12 characters)<input type="password" name="new_password" autocomplete="new-password" minlength="12" maxlength="128" required></label><p>Changing your password signs out all existing sessions.</p>', "Change password & sign out")}
          </section>
        </div>
        ${user().role === "student" ? `<details class="panel spaced"><summary>Deactivate my student account</summary><p>This hides public profile/portfolio access and signs out your sessions. Learning, financial and audit records are retained. Resolve active commitments, held payments and earnings first. Restoration requires platform support.</p>${form("deactivate-account", '<label>Confirm current password<input type="password" name="current_password" autocomplete="current-password" required></label>' + why, "Deactivate account")}</details>` : ""}`,
      user().role === "admin",
    );
  }
  const permissionBoxes = (catalog, selected = []) =>
    /* HTML */ `<div class="permission-grid">
      ${catalog.map((p) => /* HTML */ `<label><input type="checkbox" name="permission" value="${e(p)}" ${selected.includes(p) ? "checked" : ""} /> ${e(p)}</label>`).join("")}
    </div>`;
  async function access() {
    const [roles, admins] = await Promise.all([
      api("/admin/roles"),
      api("/admin/administrators"),
    ]);
    return shell(
      "admin/access",
      /* HTML */ `<h1>Administrator roles & access</h1>
        <p>
          Administrator accounts are separate from student accounts. Permissions
          are checked on every API request. The recovery superadministrator role
          cannot be edited.
        </p>
        <details class="panel">
          <summary>Create a separate administrator</summary>
          ${form("administrator-new", '<label>Name<input name="name" minlength="2" maxlength="120" required></label><label>Email<input type="email" name="email" required></label><label>Initial password (12+ characters)<input type="password" name="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Role<select name="admin_role">' + roles.items.map((r) => `<option value="${e(r.key)}">${e(r.label)}</option>`).join("") + "</select></label>" + why, "Create protected administrator")}
        </details>
        <h2 class="spaced">Administrator accounts</h2>
        ${admins.items
          .map(
            (a) =>
              /* HTML */ `<section class="panel exchange-card">
                <h3>${e(a.name)} · ${e(a.admin_role)}</h3>
                <p>${e(a.email)} · ${a.suspended ? "suspended" : "active"}</p>
                ${
                  a.id !== user().id
                    ? form(
                        "administrator-edit-" + a.id,
                        /* HTML */ `<label
                            >Role<select name="admin_role">
                              ${roles.items.map((r) => `<option value="${e(r.key)}" ${r.key === a.admin_role ? "selected" : ""}>${e(r.label)}</option>`).join("")}
                            </select></label
                          >${checkbox("suspended", "Suspend administrator access", a.suspended)}${why}`,
                        "Update administrator access",
                      )
                    : "<p>Your own role/access cannot be changed here.</p>"
                }
              </section>`,
          )
          .join("")}
        <h2 class="spaced">Permission roles</h2>
        <details class="panel">
          <summary>Create restricted role</summary>
          ${form("role-new", '<label>Role key (lowercase letters, digits, underscore)<input name="key" pattern="[a-z][a-z0-9_]{2,30}" required></label><label>Label<input name="label" minlength="2" maxlength="120" required></label>' + permissionBoxes(roles.catalog) + why, "Create role")}
        </details>
        ${roles.items
          .map(
            (r) =>
              /* HTML */ `<section class="panel exchange-card">
                <h3>${e(r.label)} · ${e(r.key)}</h3>
                ${r.key === "superadmin" ? "<p>All permissions. Recovery role; not editable.</p>" : form("role-edit-" + r.key, /* HTML */ `<label>Label<input name="label" value="${e(r.label)}" minlength="2" maxlength="120" required /></label>${permissionBoxes(roles.catalog, r.permissions)}${why}`, "Save role permissions")}
              </section>`,
          )
          .join("")}`,
      true,
    );
  }
  async function support(admin = false) {
    const d = await api(admin ? "/admin/complaints" : "/support/tickets");
    return shell(
      admin ? "admin/support" : "dashboard/help",
      /* HTML */ `<h1>${admin ? "Support requests" : "Help & support"}</h1>
        <p>
          General account/platform help. Use
          <a href="#dashboard/disputes">Payment complaints</a> for payment holds
          and evidence.
        </p>
        ${!admin ? `<details class="panel"><summary>Open a support request</summary>${form("support-new", '<label>Subject<input name="subject" minlength="2" maxlength="120" required></label><label>Describe the issue<textarea name="body" minlength="10" maxlength="6000" required></textarea></label>', "Submit support request")}</details>` : ""}${
          d.items
            .map(
              (t) =>
                /* HTML */ `<section class="panel exchange-card">
                  <div class="row">
                    <div>
                      <h3>${e(t.subject)}</h3>
                      <p>
                        ${admin ? e(t.name) + " · " + e(t.email) + " · " : ""}${e(t.status)}
                        · ${date(t.created_at)}
                      </p>
                    </div>
                    <a
                      class="button secondary small"
                      href="#${admin ? "admin" : "dashboard"}/ticket/${t.id}"
                      >Open request</a
                    >
                  </div>
                </section>`,
            )
            .join("") ||
          '<div class="panel empty">No support requests yet.</div>'
        }`,
      admin,
    );
  }
  async function ticket(id, admin = false) {
    const d = await api("/support/tickets/" + id),
      t = d.ticket;
    const queue =
      admin && can("support.write") ? await api("/admin/complaints") : null;
    return shell(
      admin ? "admin/support" : "dashboard/help",
      /* HTML */ `<a href="#${admin ? "admin/support" : "dashboard/help"}"
          >← Support requests</a
        >
        <h1 class="spaced">${e(t.subject)}</h1>
        <section class="panel">
          <span class="pill">${e(t.status)}</span>
          <p class="preserve-lines spaced">${e(t.body)}</p>
          ${t.resolution_reason ? /* HTML */ `<p>Recorded status reason: ${e(t.resolution_reason)}</p>` : ""}
        </section>
        <h2 class="spaced">Conversation</h2>
        <section class="panel">
          ${
            d.replies
              .map(
                (r) =>
                  /* HTML */ `<article class="message">
                    <strong>${e(r.name)}</strong>
                    <p>${e(r.body)}</p>
                    <small>${date(r.created_at)}</small>
                  </article>`,
              )
              .join("") || "<p>No replies yet.</p>"
          }${t.status !== "resolved" && (!admin || can("support.write")) ? form("support-reply", /* HTML */ `<input type="hidden" name="id" value="${id}" /><label>Reply<textarea name="body" minlength="10" maxlength="6000" required></textarea></label>`, "Send in-app reply") : ""}
        </section>
        ${
          queue
            ? /* HTML */ `<section class="panel spaced">
                <h2>Assignment & resolution</h2>
                ${form(
                  "support-status",
                  /* HTML */ `<input
                      type="hidden"
                      name="id"
                      value="${id}"
                    /><label
                      >Status<select name="status">
                        ${["open", "in_progress", "resolved"].map((s) => `<option ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}
                      </select></label
                    ><label
                      >Assigned administrator<select name="assigned_to">
                        <option value="">Unassigned</option>
                        ${queue.administrators.map((a) => `<option value="${a.id}" ${t.assigned_to === a.id ? "selected" : ""}>${e(a.name)}</option>`).join("")}
                      </select></label
                    >${why}`,
                  "Record support decision",
                )}
              </section>`
            : ""
        }`,
      admin,
    );
  }
  async function commitments() {
    const d = await api("/account/commitments");
    return shell(
      "dashboard/commitments",
      /* HTML */ `<h1>Reservations & cancellations</h1>
        <p>
          <a href="#policies">Read platform policies</a>. Cancellation keeps
          learning/transaction history. Eligible paid cancellations give a full
          remaining simulated refund; no real money moves.
        </p>
        <h2>Session reservations</h2>
        ${
          d.bookings
            .map(
              (b) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>${e(b.title)} · Booking #${b.id}</h3>
                  <p>${date(b.starts_at)} · Asia/Dhaka · ${e(b.status)}</p>
                  <p>${e(b.cancellation.reason)}</p>
                  ${b.cancellation.allowed ? form("cancel-booking-" + b.id, why, "Cancel reservation") : ""}
                </section>`,
            )
            .join("") || "<p>No reservations.</p>"
        }
        <h2 class="spaced">Active reciprocal exchanges</h2>
        ${
          d.exchanges
            .map((x) => {
              const pending = d.exchange_cancellations.find(
                (c) => c.exchange_id === x.id && c.status === "pending",
              );
              return /* HTML */ `<section class="panel exchange-card">
                <h3>
                  #${x.id} · ${e(x.requester_skill)} ↔ ${e(x.recipient_skill)}
                </h3>
                ${
                  pending
                    ? /* HTML */ `<p>${e(pending.reason)}</p>
                        <div class="actions">
                          ${pending.proposer_id === user().id ? `<button class="secondary exchange-cancel-response" data-id="${pending.id}" data-action="cancel">Withdraw request</button>` : `<button class="exchange-cancel-response" data-id="${pending.id}" data-action="accept">Accept mutual cancellation</button><button class="secondary exchange-cancel-response" data-id="${pending.id}" data-action="reject">Keep agreement</button>`}
                        </div>`
                    : form(
                        "cancel-exchange-" + x.id,
                        "<p>The current schedule remains reserved until your partner explicitly accepts.</p>" +
                          why,
                        "Propose mutual cancellation",
                      )
                }
              </section>`;
            })
            .join("") || "<p>No active exchanges.</p>"
        }
        <h2 class="spaced">Exchange cancellation history</h2>
        <section class="panel">
          ${
            d.exchange_cancellations
              .map(
                (c) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong
                        >Exchange #${c.exchange_id} · ${e(c.status)}</strong
                      >
                      <p>${e(c.reason)}</p>
                    </div>
                  </div>`,
              )
              .join("") || "<p>No cancellation requests.</p>"
          }
        </section>`,
    );
  }
  async function reports() {
    report = await api("/admin/reports");
    return shell(
      "admin/reports",
      /* HTML */ `<h1>Platform reports</h1>
        <p>
          Counts calculated from stored data. Financial activity remains
          sandbox-only.
        </p>
        <div class="stats">
          ${Object.entries(report.metrics)
            .map(
              ([name, n]) =>
                /* HTML */ `<div class="panel stat">
                  ${e(name.replaceAll("_", " "))}<strong>${n}</strong>
                </div>`,
            )
            .join("")}
        </div>
        <h2>Monthly reservation creation</h2>
        <table class="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Reservations</th>
            </tr>
          </thead>
          <tbody>
            ${report.bookings_by_month.map((m) => `<tr><td>${e(m.month)}</td><td>${m.total}</td></tr>`).join("") || '<tr><td colspan="2">No records.</td></tr>'}
          </tbody>
        </table>
        <button class="secondary spaced" id="export-report">
          Download summary CSV
        </button>`,
      true,
    );
  }
  async function render(route) {
    if (route === "policies") return policies();
    if (route === "announcements") return announcements();
    if (route === "dashboard/account") return account();
    if (route === "dashboard/commitments") return commitments();
    if (route === "dashboard/help") return support();
    if (route.startsWith("dashboard/ticket/"))
      return ticket(Number(route.split("/")[2]));
    if (route.startsWith("admin/ticket/"))
      return ticket(Number(route.split("/")[2]), true);
    if (route === "admin/users") return users();
    if (route === "admin/categories") return categories();
    if (route === "admin/listings") return listings();
    if (route === "admin/policies") return policies(true);
    if (route === "admin/announcements") return announcements(true);
    if (route === "admin/access") return access();
    if (route === "admin/support") return support(true);
    return reports();
  }
  function wire() {
    bind("student-search", async (b) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(b)) if (v) q.set(k, v);
      navigate("admin/users?" + q);
    });
    document.querySelectorAll(".student-page").forEach((b) =>
      b.addEventListener("click", () => {
        const q = new URLSearchParams(location.hash.split("?")[1] || "");
        q.set("page", b.dataset.page);
        navigate("admin/users?" + q);
      }),
    );
    bind("listing-search", async (b) =>
      navigate("admin/listings?q=" + encodeURIComponent(b.q)),
    );
    document.querySelectorAll('[id^="student-status-"]').forEach((f) =>
      bind(f.id, async (b) =>
        act(`/admin/users/${f.id.split("-").pop()}/status`, "POST", {
          suspended: b.suspended === "true",
          reason: b.reason,
        }),
      ),
    );
    bind("category-new", async (b) => act("/admin/categories", "POST", b));
    document.querySelectorAll('[id^="category-edit-"]').forEach((f) =>
      bind(f.id, async (b) =>
        act("/admin/categories/" + f.id.split("-").pop(), "PUT", {
          ...b,
          active: b.active === "on",
        }),
      ),
    );
    document
      .querySelectorAll('[id^="listing-moderation-"]')
      .forEach((f) =>
        bind(f.id, async (b) =>
          act(
            "/admin/listings/" + f.id.split("-").pop() + "/moderate",
            "POST",
            b,
          ),
        ),
      );
    bind("policy-edit", async (b) =>
      act("/admin/policies", "PUT", {
        revision: Number(b.revision),
        commission_bps: Math.round(Number(b.commission_percent) * 100),
        completion_response_hours: Number(b.completion_response_hours),
        cancellation_notice_hours: Number(b.cancellation_notice_hours),
        registration_open: b.registration_open === "on",
        listing_publication_open: b.listing_publication_open === "on",
        policy_text: b.policy_text,
        reason: b.reason,
      }),
    );
    const ann = (b) => ({ ...b, published: b.published === "on" });
    bind("announcement-new", async (b) =>
      act("/admin/announcements", "POST", ann(b)),
    );
    document
      .querySelectorAll('[id^="announcement-edit-"]')
      .forEach((f) =>
        bind(f.id, async (b) =>
          act("/admin/announcements/" + f.id.split("-").pop(), "PUT", ann(b)),
        ),
      );
    bind("account-settings", async (b) => {
      notice(
        (
          await api("/account/settings", "PUT", {
            profile_public:
              user().role === "student" ? b.profile_public === "on" : true,
            notifications: {
              activity: b.activity === "on",
              session_reminders: b.session_reminders === "on",
            },
          })
        ).message,
      );
      await refreshUser();
      reload();
    });
    bind("change-password", async (b) => {
      notice((await api("/account/password", "POST", b)).message);
      await onSignedOut();
    });
    bind("deactivate-account", async (b) => {
      notice((await api("/account/deactivate", "POST", b)).message);
      await onSignedOut();
    });
    bind("administrator-new", async (b) =>
      act("/admin/administrators", "POST", b),
    );
    document.querySelectorAll('[id^="administrator-edit-"]').forEach((f) =>
      bind(f.id, async (b) =>
        act("/admin/administrators/" + f.id.split("-").pop(), "PUT", {
          ...b,
          suspended: b.suspended === "on",
        }),
      ),
    );
    const permissions = (f) =>
      [...f.querySelectorAll("input[name=permission]:checked")].map(
        (c) => c.value,
      );
    bind("role-new", async (b, f) =>
      act("/admin/roles", "POST", {
        key: b.key,
        label: b.label,
        permissions: permissions(f),
        reason: b.reason,
      }),
    );
    document.querySelectorAll('[id^="role-edit-"]').forEach((f) =>
      bind(f.id, async (b, f) => {
        await act("/admin/roles/" + f.id.slice("role-edit-".length), "PUT", {
          label: b.label,
          permissions: permissions(f),
          reason: b.reason,
        });
        await refreshUser();
      }),
    );
    bind("support-new", async (b) => {
      const r = await api("/support/tickets", "POST", b);
      notice(r.message);
      location.hash = "dashboard/ticket/" + r.ticket.id;
    });
    bind("support-reply", async (b) =>
      act("/support/tickets/" + b.id + "/replies", "POST", { body: b.body }),
    );
    bind("support-status", async (b) =>
      act("/admin/complaints/" + b.id + "/status", "POST", {
        status: b.status,
        assigned_to: b.assigned_to ? Number(b.assigned_to) : null,
        reason: b.reason,
      }),
    );
    document.querySelectorAll('[id^="cancel-booking-"]').forEach((f) =>
      bind(f.id, async (b) => {
        const identity = f.id + ":" + b.reason;
        const key = keys.get(identity) || crypto.randomUUID();
        keys.set(identity, key);
        notice(
          (
            await api(
              "/bookings/" + f.id.split("-").pop() + "/cancel",
              "POST",
              { reason: b.reason, idempotency_key: key },
            )
          ).message,
        );
        keys.delete(identity);
        reload();
      }),
    );
    document
      .querySelectorAll('[id^="cancel-exchange-"]')
      .forEach((f) =>
        bind(f.id, async (b) =>
          act(
            "/exchanges/" + f.id.split("-").pop() + "/cancellation",
            "POST",
            b,
          ),
        ),
      );
    document
      .querySelectorAll(".exchange-cancel-response")
      .forEach((b) =>
        b.addEventListener("click", () =>
          buttonRun(b, () =>
            api(
              "/exchange-cancellations/" + b.dataset.id + "/respond",
              "POST",
              { action: b.dataset.action },
            ),
          ),
        ),
      );
    document.querySelector("#export-report")?.addEventListener("click", () => {
      const rows = [
        ["Metric", "Value"],
        ...Object.entries(report.metrics),
        ["Month", "Reservations"],
        ...report.bookings_by_month.map((m) => [m.month, m.total]),
      ];
      const csv = rows
        .map((r) =>
          r.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
        )
        .join("\r\n");
      const url = URL.createObjectURL(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "skill-swap-summary.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  async function act(url, method, body) {
    notice((await api(url, method, body)).message);
    reload();
  }
  function navigate(hash) {
    if (location.hash === "#" + hash) reload();
    else location.hash = hash;
  }
  function buttonRun(b, run) {
    b.disabled = true;
    Promise.resolve()
      .then(run)
      .then((r) => {
        notice(r.message);
        reload();
      })
      .catch((err) => notice(err.message))
      .finally(() => (b.disabled = false));
  }
  return { render, wire };
}
