import { createAdministrationUI } from "./administration.js";
import { createProjectUI } from "./projects.js";
import { createPaymentUI } from "./payments.js";
import { createLearningUI } from "./learning.js";
import { createExchangeUI } from "./exchanges.js";
import { strings as s } from "./strings.js";
const $ = (q) => document.querySelector(q),
  e = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let user = null,
  csrf = "",
  page = 1,
  categories = [];
const money = (n) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
const date = (d) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: s.timezone,
  }).format(new Date(d));
const initials = (n) =>
  e(
    n
      .split(" ")
      .map((x) => x[0])
      .slice(0, 2)
      .join(""),
  );
async function api(url, method = "GET", body) {
  const headers = {};
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch("/api" + url, {
    method,
    headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Request failed.");
  return data;
}
function notice(text) {
  $("#notice").textContent = text;
  $("#notice").style.display = "block";
  setTimeout(() => ($("#notice").style.display = "none"), 6000);
}
function account() {
  $("#account").innerHTML = user
    ? /* HTML */ `<span class="name">${e(user.name.split(" ")[0])}</span
        ><a
          class="button small"
          href="#${user.role === "admin" ? adminHome() : "dashboard"}"
          >Dashboard</a
        ><button class="secondary small" id="logout">Sign out</button>`
    : '<a href="#login">Sign in</a><a class="button small" href="#register">Join Skill Swap ↗</a>';
  $("#logout")?.addEventListener("click", async () => {
    try {
      await api("/auth/logout", "POST");
      await refresh();
      location.hash = "home";
    } catch (err) {
      notice(err.message);
    }
  });
}
async function refresh() {
  ({ user, csrf } = await api("/auth/me"));
  account();
}
const icon =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m11 8-8 8 8 8m10-16 8 8-8 8M19 4l-6 24"/></svg>';
function card(l) {
  return /* HTML */ `<article class="card">
    <div class="card-top">
      <span class="pill">${e(l.category || "Student-led")}</span
      ><small>${e(l.level)}</small>
    </div>
    <div class="skill-icon" data-category="${e(l.category || "Skill session")}">
      ${icon}<span>${e(l.category || "Skill session")}</span>
    </div>
    <h3><a href="#skill/${l.id}">${e(l.title)}</a></h3>
    <p>
      ${e(l.description.slice(0, 115))}${l.description.length > 115 ? "…" : ""}
    </p>
    <div class="mentor">
      <span class="avatar"
        >${initials(l.mentor_name || user?.name || "Student Mentor")}</span
      ><span
        >${l.mentor_profile_public === false ? e(l.mentor_name || user?.name) : /* HTML */ `<a href="#mentor/${l.mentor_id}">${e(l.mentor_name || user?.name)}</a>`}<br /><small
          >Student Mentor · ${l.duration_minutes} min</small
        ></span
      >
    </div>
    <div class="card-bottom">
      <div><strong>${money(l.fee_minor)}</strong><small> / session</small></div>
      ${l.exchange_enabled ? '<span class="pill teal">Exchange available</span>' : ""}
    </div>
  </article>`;
}
const field = (name, label, type = "text", value = "", extra = "") =>
  /* HTML */ `<label
    >${label}<input
      name="${name}"
      type="${type}"
      value="${e(value)}"
      ${extra}
      required
  /></label>`;
function form(id, content, submit) {
  return /* HTML */ `<form id="${id}">
    ${content}<button type="submit">${submit}</button>
    <p class="form-error" role="alert"></p>
  </form>`;
}
function bind(id, run) {
  $("#" + id)?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget,
      b = f.querySelector("button[type=submit]");
    b.disabled = true;
    f.querySelector(".form-error").textContent = "";
    try {
      await run(Object.fromEntries(new FormData(f)), f);
    } catch (err) {
      f.querySelector(".form-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  });
}
function can(permission) {
  return (
    user?.permissions?.includes("*") || user?.permissions?.includes(permission)
  );
}
const adminNavigationPermissions = {
  admin: "overview.read",
  "admin/verification": "verification.read",
  "admin/audit": "audit.read",
  "admin/exchanges": "exchanges.read",
  "admin/learning": "bookings.read",
  "admin/payments": "payments.read",
  "admin/disputes": "disputes.read",
  "admin/reviews": "reviews.read",
  "admin/portfolios": "portfolios.read",
  "admin/users": "users.read",
  "admin/categories": "categories.read",
  "admin/listings": "listings.read",
  "admin/announcements": "announcements.read",
  "admin/policies": "policies.read",
  "admin/access": "roles.manage",
  "admin/support": "support.read",
  "admin/reports": "reports.read",
};
function adminHome() {
  return (
    Object.keys(adminNavigationPermissions).find((path) =>
      can(adminNavigationPermissions[path]),
    ) || "dashboard/account"
  );
}
function shell(active, body, admin = false) {
  const links = admin
    ? [
        ["admin", "Overview"],
        ["admin/verification", "Verification queue"],
        ["admin/audit", "Audit log"],
        ["admin/exchanges", "Exchanges & reports"],
        ["admin/learning", "Session inspection"],
        ["admin/payments", "Payments & withdrawals"],
        ["admin/disputes", "Payment disputes"],
        ["admin/reviews", "Review moderation"],
        ["admin/portfolios", "Portfolio moderation"],
        ["admin/users", "Student accounts"],
        ["admin/categories", "Categories"],
        ["admin/listings", "Listing moderation"],
        ["admin/announcements", "Announcements"],
        ["admin/policies", "Policy settings"],
        ["admin/access", "Roles & access"],
        ["admin/support", "Support requests"],
        ["admin/reports", "Reports"],
        ["dashboard/account", "My account"],
      ]
    : [
        ["dashboard", "Overview"],
        ["dashboard/learning", "My learning"],
        ["dashboard/teaching", "My teaching"],
        ["dashboard/schedule", "Schedule"],
        ["dashboard/messages", "Messages & materials"],
        ["dashboard/notifications", "Notifications"],
        ["dashboard/payments", "Payments & earnings"],
        ["dashboard/disputes", "Payment complaints"],
        ["dashboard/projects", "Exercises & projects"],
        ["dashboard/portfolio", "My portfolio"],
        ["dashboard/reviews", "Reviews"],
        ["dashboard/saved", "Saved skills"],
        ["dashboard/exchanges", "My exchanges"],
        ["dashboard/matches", "Find exchange partners"],
        ["dashboard/preferences", "Exchange preferences"],
        ["dashboard/settings", "Profile & verification"],
        ["dashboard/account", "Account & privacy"],
        ["dashboard/commitments", "Cancellations"],
        ["dashboard/help", "Help & support"],
      ];
  return /* HTML */ `<div class="layout">
    <aside class="sidebar">
      ${links
        .filter(
          ([h]) =>
            !admin ||
            !adminNavigationPermissions[h] ||
            can(adminNavigationPermissions[h]),
        )
        .map(
          ([h, t]) =>
            /* HTML */ `<a class="${h === active ? "active" : ""}" href="#${h}"
              >${t}</a
            >`,
        )
        .join("")}
    </aside>
    <section>${body}</section>
  </div>`;
}
async function home() {
  const { items } = await api("/listings");
  return /* HTML */ `<section class="hero">
      <div>
        <div class="eyebrow">A CAMPUS FULL OF POSSIBILITIES</div>
        <h1>
          Learn something new.<br /><em>From someone<br />like you.</em>
        </h1>
        <p>
          Find a student who can help you take the next step. Book a focused
          session, share your own skills, or learn from each other through an
          exchange.
        </p>
        <div class="actions">
          <a class="button" href="#explore">Find your next skill ↗</a
          ><a class="button secondary" href="#exchange"
            >Explore skill exchange</a
          >
        </div>
        <div class="checks">
          <span>✓ Students only</span><span>✓ Practical learning</span>
        </div>
      </div>
      <div class="hero-art">
        <div class="art-top">
          <span>Better, together</span
          ><span class="exchange-tag">SKILL EXCHANGE</span>
        </div>
        <div class="mini">
          <span class="avatar">AR</span>
          <div>
            <strong>I can teach web design.</strong
            ><small>I want to learn presentation skills.</small>
          </div>
        </div>
        <div class="exchange-arrow">↕</div>
        <div class="mini">
          <span class="avatar">NA</span>
          <div>
            <strong>I can teach public speaking.</strong
            ><small>I want to build my first website.</small>
          </div>
        </div>
        <div class="art-foot">
          An example of what you can learn from each other
        </div>
      </div>
    </section>
    <div class="strip">
      <div>
        <strong>01 / Learn a Skill</strong>
        <p>Focused sessions at student-friendly prices.</p>
      </div>
      <div>
        <strong>02 / Teach a Skill</strong>
        <p>Turn your experience into someone's next step.</p>
      </div>
      <div>
        <strong>03 / Exchange a Skill</strong>
        <p>Share what you know. Learn something new.</p>
      </div>
    </div>
    <div class="section-heading">
      <div>
        <div class="eyebrow">FIND YOUR STARTING POINT</div>
        <h2>Skills worth making time for</h2>
      </div>
      <a href="#explore">View all skills →</a>
    </div>
    <div class="grid">${items.slice(0, 6).map(card).join("")}</div>`;
}
async function explore() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  params.set("page", page);
  const data = await api("/listings?" + params);
  return /* HTML */ `<div class="eyebrow">THE STUDENT SKILL MARKETPLACE</div>
    <h1>What will you learn next?</h1>
    <p>Real practice. A fellow student. A new possibility.</p>
    <form id="filters" class="filters">
      <label
        >Search skills<input
          name="q"
          value="${e(params.get("q") || "")}"
          placeholder="Try web design, English, Python…" /></label
      ><label
        >Category<select name="category">
          <option value="">All categories</option>
          ${categories.map((c) => `<option value="${c.id}" ${String(c.id) === params.get("category") ? "selected" : ""}>${e(c.name)}</option>`).join("")}
        </select></label
      ><label
        >Level<select name="level">
          <option value="">All levels</option>
          ${["Beginner", "Intermediate", "Advanced"].map((v) => `<option ${v === params.get("level") ? "selected" : ""}>${v}</option>`).join("")}
        </select></label
      ><label
        >Maximum fee (BDT)<input
          name="max_bdt"
          type="number"
          min="0"
          value="${params.has("max_price") ? Number(params.get("max_price")) / 100 : ""}" /></label
      ><button>Search</button>
    </form>
    <p>
      ${data.total} skills available · Student identity is reviewed; teaching
      ability is not certified.
    </p>
    <div class="grid">
      ${data.items.map(card).join("") || '<div class="panel empty">No matching skills. Try a broader search.</div>'}
    </div>
    <div class="pagination">
      <button class="secondary" id="prev" ${page <= 1 ? "disabled" : ""}>
        ← Previous</button
      ><span>Page ${page} of ${Math.max(1, data.pages)}</span
      ><button
        class="secondary"
        id="next"
        ${page >= data.pages ? "disabled" : ""}
      >
        Next →
      </button>
    </div>`;
}
async function detail(id) {
  const { listing: l, slots } = await api("/listings/" + id);
  return /* HTML */ `<a href="#explore">← Explore skills</a>
    <div class="two detail">
      <section>
        <span class="pill">${e(l.category)}</span>
        <h1>${e(l.title)}</h1>
        <p>${e(l.description)}</p>
        <div class="panel">
          <h2>What you'll work on</h2>
          <p>${e(l.objectives)}</p>
          <h3>Before you start</h3>
          <p>${e(l.prerequisites) || "No prerequisites."}</p>
        </div>
        <div class="panel">
          <h3>Your Student Mentor</h3>
          ${l.mentor_profile_public === false ? e(l.mentor_name) : /* HTML */ `<a href="#mentor/${l.mentor_id}">${e(l.mentor_name)}</a>`}
          <p>${e(l.institution)}</p>
          <p>${e(l.bio)}</p>
          <small>${s.verification}</small>
        </div>
      </section>
      <aside class="panel">
        <h2>${money(l.fee_minor)} <small>/ session</small></h2>
        <p>${l.duration_minutes} minutes · ${e(l.level)}</p>
        <span class="pill teal"
          >${l.exchange_enabled ? "Open to skill exchange" : "Paid session"}</span
        ><button class="secondary small save-skill" data-id="${l.id}">
          Save this skill
        </button>
        <h3 class="spaced">Reserve a time</h3>
        <p>All times shown in Asia/Dhaka.</p>
        ${
          slots.length
            ? form(
                "booking",
                /* HTML */ `<label
                  >Available slot<select name="slot_id">
                    ${slots.map((x) => `<option value="${x.id}">${date(x.starts_at)}</option>`).join("")}
                  </select></label
                >`,
                "Reserve session",
              )
            : "<p>No available slots right now.</p>"
        }
        <div class="note">
          Paid sessions use sandbox checkout and simulated payment protection.
          No real money is charged.
        </div>
      </aside>
    </div>`;
}
function authPage(kind) {
  if (kind === "register")
    return /* HTML */ `<section class="panel form-panel">
      <div class="eyebrow">START WITH WHAT YOU KNOW</div>
      <h1>Join your student community.</h1>
      <p>One account to learn, teach, and exchange.</p>
      ${form("register", field("name", "Full name") + field("institution", "College or university") + field("email", "Email address", "email") + field("password", "Password (at least 12 characters)", "password", "", 'minlength="12" maxlength="128"') + '<label><input type="checkbox" name="enrolled" required> I am currently enrolled in a college or university. I am not registering as a professional teacher or coaching centre.</label>', "Create account")}
      <p>Already a member? <a href="#login">Sign in</a></p>
    </section>`;
  if (kind === "recover")
    return /* HTML */ `<section class="panel form-panel">
      <h1>Recover your account</h1>
      ${form("recover", field("email", "Email address", "email"), "Send reset instructions")}
      <p>Follow the reset instructions to choose a new password.</p>
    </section>`;
  if (kind === "reset")
    return /* HTML */ `<section class="panel form-panel">
      <h1>Choose a new password</h1>
      ${form("reset", field("password", "New password", "password", "", 'minlength="12" maxlength="128"'), "Reset password")}
    </section>`;
  return /* HTML */ `<section class="panel form-panel">
    <div class="eyebrow">WELCOME BACK</div>
    <h1>Keep your curiosity going.</h1>
    ${form("login", field("email", "Email address", "email") + field("password", "Password", "password"), "Sign in")}
    <p>
      <a href="#recover">Forgot password?</a> ·
      <a href="#register">Create an account</a>
    </p>
    <div class="note">
      Demo: student1@skillswap.test<br />Password: StudentDemo!2026<br />Fictional
      accounts for local demonstration.
    </div>
  </section>`;
}
function listingForm(l = {}) {
  return form(
    "listing",
    /* HTML */ `<input
        type="hidden"
        name="id"
        value="${l.id || ""}"
      />${field("title", "Skill title", "text", l.title)}<label
        >Category<select name="category_id">
          ${categories.map((c) => `<option value="${c.id}" ${c.id === l.category_id ? "selected" : ""}>${e(c.name)}</option>`).join("")}
        </select></label
      ><label
        >Description<textarea name="description" required>
${e(l.description)}</textarea></label
      ><label
        >Learning objectives<textarea name="objectives" required>
${e(l.objectives)}</textarea></label
      ><label
        >Prerequisites<textarea name="prerequisites">
${e(l.prerequisites)}</textarea></label
      ><label
        >Level<select name="level">
          ${["Beginner", "Intermediate", "Advanced"].map((x) => `<option ${l.level === x ? "selected" : ""}>${x}</option>`).join("")}
        </select></label
      >${field("duration_minutes", "Duration (15–180 minutes)", "number", l.duration_minutes || 60, 'min="15" max="180"')}${field("fee", "Session fee (BDT)", "number", (l.fee_minor || 0) / 100, 'min="0" max="100000" step="0.01"')}<label
        ><input
          type="checkbox"
          name="exchange_enabled"
          ${l.exchange_enabled !== false ? "checked" : ""}
        />
        Open to exchange</label
      ><label
        >Status<select name="status">
          ${["draft", "published", "inactive"].map((x) => `<option ${l.status === x ? "selected" : ""}>${x}</option>`).join("")}
        </select></label
      >`,
    "Save listing",
  );
}
async function dashboard(route) {
  if (!user) return authPage("login");
  const d = await api("/dashboard");
  const bookings = d.bookings.filter((b) =>
    route === "dashboard/learning" ? b.learner_id === user.id : true,
  );
  const exchangeRows = (d.exchange_sessions || [])
    .map(
      (s) =>
        /* HTML */ `<div class="row">
          <div>
            <strong
              >Exchange #${s.exchange_id} · ${e(s.requester_name)} ↔
              ${e(s.recipient_name)}</strong
            >
            <p>${date(s.starts_at)} · Asia/Dhaka</p>
            <small
              >${s.teacher_id === user.id ? "You teach" : "You learn"} ·
              ${s.teacher_completed && s.learner_confirmed ? "Completed and confirmed" : "Scheduled"}</small
            >
          </div>
          <a
            class="button secondary small"
            href="#dashboard/room/exchange/${s.exchange_id}"
            >Open learning room</a
          >
        </div>`,
    )
    .join("");
  const rows =
    bookings
      .map(
        (b) =>
          /* HTML */ `<div class="row">
            <div>
              <strong>${e(b.title)}</strong>
              <p>${date(b.starts_at)} · Asia/Dhaka</p>
              <small
                >Mentor: ${e(b.mentor_name)} · Learner:
                ${e(b.learner_name)}</small
              >
            </div>
            <div>
              <span class="pill"
                >${e(b.learning_status || b.status)} ·
                ${money(b.amount_minor)}</span
              ><br /><a href="#dashboard/room/booking/${b.id}"
                >Open learning room →</a
              >${b.payment_required && b.learner_id === user.id ? `<br><a href="#checkout/${b.id}">Sandbox checkout / receipt →</a>` : ""}
            </div>
          </div>`,
      )
      .join("") ||
    '<p class="empty">No sessions yet. <a href="#explore">Explore skills</a></p>';
  let body = "";
  if (route === "dashboard/settings")
    body = /* HTML */ `<h1>Profile & verification</h1>
      <div class="two">
        <div class="panel">
          ${form("profile", field("name", "Name", "text", user.name) + field("institution", "Institution", "text", user.institution) + /* HTML */ `<label>Introduction<textarea name="bio">${e(user.bio)}</textarea></label>`, "Save profile")}
        </div>
        <div class="panel">
          <h2>Student verification</h2>
          <span class="pill">${e(user.verification)}</span>
          <p>
            ${e(d.verification?.reason || "Upload your current student ID for manual review.")}
          </p>
          ${!["approved", "pending"].includes(user.verification) ? form("verify", '<label>Private student ID (PDF, PNG, JPEG, max 5 MB)<input name="document" type="file" accept=".pdf,.png,.jpg,.jpeg" required></label>', "Submit student ID") : ""}
          <div class="note">
            ${s.verification} Documents are available only to you and
            administrators.
          </div>
        </div>
      </div>`;
  else if (route === "dashboard/new" || route.startsWith("dashboard/edit/")) {
    const l = d.listings.find((x) => x.id === Number(route.split("/")[2]));
    body = /* HTML */ `<h1>${l ? "Edit" : "Create"} a skill listing</h1>
      <div class="panel">${listingForm(l)}</div>`;
  } else if (route === "dashboard/teaching")
    body = /* HTML */ `<div class="section-heading">
        <h1>My teaching</h1>
        <a class="button" href="#dashboard/new">Create listing</a>
      </div>
      ${
        d.listings
          .map(
            (l) =>
              /* HTML */ `<div class="panel">
                <div class="row">
                  <div>
                    <h3>${e(l.title)}</h3>
                    <span class="pill">${e(l.status)}</span>
                    ${money(l.fee_minor)}
                  </div>
                  <a
                    class="button secondary small"
                    href="#dashboard/edit/${l.id}"
                    >Edit listing</a
                  >
                </div>
                ${form("slot-" + l.id, field("starts_at", "Add availability (your device local time)", "datetime-local"), "Add slot")}
              </div>`,
          )
          .join("") ||
        '<div class="panel empty">Your first listing starts here. Approved verification is required.</div>'
      }`;
  else if (route === "dashboard/schedule" || route === "dashboard/learning")
    body = /* HTML */ `<h1>
        ${route.endsWith("schedule") ? "Your schedule" : "My learning"}
      </h1>
      <p>All session times shown in Asia/Dhaka.</p>
      <div class="panel">${rows}</div>
      ${
        route === "dashboard/schedule"
          ? /* HTML */ `<h2 class="spaced">Exchange sessions</h2>
              <div class="panel">
                ${exchangeRows || "<p>No exchange sessions yet.</p>"}
              </div>`
          : ""
      }`;
  else
    body = /* HTML */ `<div class="eyebrow">YOUR LEARNING SPACE</div>
      <h1>Hello, ${e(user.name.split(" ")[0])}.</h1>
      <p>A little practice today. A little more possibility tomorrow.</p>
      <div class="stats">
        <div class="panel stat">
          LEARNING
          RESERVATIONS<strong>${d.bookings.filter((b) => b.learner_id === user.id).length}</strong>Stored
          bookings
        </div>
        <div class="panel stat">
          MY SKILL LISTINGS<strong>${d.listings.length}</strong>Across all
          statuses
        </div>
        <div class="panel stat">
          TEACHING
          RESERVATIONS<strong>${d.bookings.filter((b) => b.mentor_id === user.id).length}</strong>Stored
          bookings
        </div>
      </div>
      <div class="note">
        ${(d.exchanges || []).filter((x) => x.status === "active").length}
        active exchanges ·
        ${(d.exchanges || []).filter((x) => ["pending", "negotiating"].includes(x.status)).length}
        requests or agreements awaiting action.
        <a href="#dashboard/exchanges">Open My exchanges →</a>
      </div>
      ${user.verification !== "approved" ? '<div class="note">Complete student verification to publish or reserve sessions. <a href="#dashboard/settings">Review your status →</a></div>' : ""}
      <div class="section-heading">
        <h2>Session reservations</h2>
        <a href="#explore">Find a skill →</a>
      </div>
      <div class="panel">${rows}</div>`;
  return shell(route, body);
}
async function adminPage(route) {
  if (!user) return authPage("login");
  if (user.role !== "admin") throw Error("Administrator access required.");
  let body = "";
  if (route === "admin/verification") {
    const { items } = await api("/admin/verifications");
    body = /* HTML */ `<h1>Student verification</h1>
      <p>Review enrolment only. Record a reason for every decision.</p>
      ${
        items
          .map(
            (v) =>
              /* HTML */ `<div class="panel">
                <h3>${e(v.name)} <span class="pill">${e(v.status)}</span></h3>
                <p>${e(v.email)} · ${e(v.institution)}</p>
                ${can("files.verification") ? /* HTML */ `<a href="/api/files/${v.file_id}" target="_blank" rel="noopener">Download private student ID</a>` : "File access requires a separate verification permission."}${v.status === "pending" && can("verification.write") ? form("decision-" + v.id, '<label>Decision<select name="status"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label><label>Reason<textarea name="reason" minlength="5" required></textarea></label>', "Record decision") : /* HTML */ `<p>${e(v.reason)}</p>`}
              </div>`,
          )
          .join("") || '<div class="panel empty">No submissions yet.</div>'
      }`;
  } else if (route === "admin/audit") {
    const { items } = await api("/admin/audit");
    body =
      '<h1>Audit log</h1><div class="panel">' +
      (items
        .map(
          (a) =>
            /* HTML */ `<div class="row">
              <div>
                <strong>${e(a.action)} · ${e(a.name)}</strong>
                <p>${e(a.reason)}</p>
                <small>${date(a.created_at)} · target ${e(a.target)}</small>
              </div>
            </div>`,
        )
        .join("") || "<p>No decisions recorded.</p>") +
      "</div>";
  } else {
    const d = await api("/admin/overview");
    body = /* HTML */ `<div class="eyebrow">ADMINISTRATION</div>
      <h1>Platform overview</h1>
      <p>Live counts from your database.</p>
      <div class="stats">
        ${Object.entries(d)
          .map(
            ([k, v]) =>
              /* HTML */ `<div class="panel stat">
                ${e(k.toUpperCase())}<strong>${v}</strong>
              </div>`,
          )
          .join("")}
      </div>
      ${can("verification.read") ? '<a class="button" href="#admin/verification">Review student submissions →</a>' : "<p>Use your permitted administration sections.</p>"}`;
  }
  return shell(route, body, true);
}
function info(route) {
  const content = {
    exchange: [
      "Exchange skills. Grow together.",
      "A good exchange starts with a clear agreement.",
      [
        "Offer a skill you can teach and describe what you want to learn.",
        "Find a student with complementary interests and compatible availability.",
        "Agree on objectives and equal commitments, then track each side independently.",
      ],
      "Sign in to add your skill preferences, find explained matches, send requests and agree on a reciprocal schedule. Both students accept the same revision before sessions become active.",
    ],
    help: [
      "A little help, when you need it.",
      "Use this guide to explore the current demonstration.",
      [
        "Create an account, sign in, and upload a current student ID under Profile & verification.",
        "An administrator reviews the document with a recorded reason.",
        "Approved students can publish skills, add availability and reserve sessions.",
      ],
      "For local demonstrations, sign in as admin@skillswap.test using StudentDemo!2026 to review submissions. These credentials must not be used on a public deployment.",
    ],
    policies: [
      "Clear expectations. Better learning.",
      "Skill Swap is for currently enrolled college and university students.",
      [
        "Professional teachers and coaching centres may not offer services.",
        "Student verification confirms enrolment, not teaching quality. Do not share private documents in public profiles.",
        "Payments, refunds and withdrawals are sandbox simulations. Allocations remain held until learner confirmation or a reasoned dispute decision. Native video calling is not provided.",
      ],
      "This demonstration stores profiles, verification, learning records and sandbox transaction history in PostgreSQL. Uploaded student IDs remain private on the server. Do not upload genuine sensitive documents to a shared demonstration.",
    ],
  };
  const [title, sub, steps, note] = content[route] || content.help;
  return /* HTML */ `<div class="intro">
    <div class="eyebrow">SKILL SWAP / ${e(route.toUpperCase())}</div>
    <h1>${title}</h1>
    <p>${sub}</p>
    ${steps
      .map(
        (x, i) =>
          /* HTML */ `<div class="panel">
            <span class="eyebrow">0${i + 1}</span>
            <p>${x}</p>
          </div>`,
      )
      .join("")}
    <div class="note">${note}</div>
    <div class="actions">
      <a class="button" href="#explore">Explore skills →</a
      >${route === "exchange" ? '<a class="button secondary" href="#dashboard/preferences">Set up your exchange →</a>' : ""}
    </div>
  </div>`;
}
async function render() {
  const route = location.hash.slice(1).split("?")[0] || "home";
  $("#app").innerHTML = "<p>Loading…</p>";
  try {
    let html;
    if (route === "home") html = await home();
    else if (route === "explore") html = await explore();
    else if (route.startsWith("skill/"))
      html = await detail(route.split("/")[1]);
    else if (route.startsWith("mentor/")) {
      const d = await api("/mentors/" + route.split("/")[1]);
      html = /* HTML */ `<span class="avatar">${initials(d.mentor.name)}</span>
        <h1>${e(d.mentor.name)}</h1>
        <p>${e(d.mentor.institution)}</p>
        <p>${e(d.mentor.bio)}</p>
        <div class="note">${s.verification}</div>
        <div class="stats">
          <div class="panel stat">
            CONFIRMED TEACHING
            SESSIONS<strong>${d.statistics.completed_sessions}</strong>Bookings
            and exchange sessions
          </div>
          <div class="panel stat">
            ELIGIBLE PUBLIC
            REVIEWS<strong>${d.statistics.review_count}</strong>${d.statistics.average_rating === null ? "No ratings yet" : d.statistics.average_rating.toFixed(1) + " / 5 average"}
          </div>
        </div>
        <h2>Skills from this Student Mentor</h2>
        <div class="grid">
          ${d.listings.map((l) => card({ ...l, mentor_name: d.mentor.name })).join("") || "<p>No published listings.</p>"}
        </div>
        <h2 class="spaced">Student portfolio</h2>
        <div class="grid">
          ${
            d.portfolio
              .map(
                (p) =>
                  /* HTML */ `<article class="panel">
                    <span class="pill"
                      >${p.reviewed_project ? "Reviewed task" : "Independent work"}</span
                    >
                    <h3 class="spaced">
                      <a href="#portfolio/${p.id}">${e(p.title)}</a>
                    </h3>
                    <p>${e(p.description.slice(0, 180))}</p>
                    <a href="#portfolio/${p.id}">View project →</a>
                  </article>`,
              )
              .join("") || "<p>No public portfolio work yet.</p>"
          }
        </div>
        <h2 class="spaced">Participant reviews</h2>
        ${
          d.reviews
            .map(
              (r) =>
                /* HTML */ `<article class="panel exchange-card">
                  <h3>${e(r.author_name)} · ${r.rating}/5</h3>
                  <p>${e(r.comment)}</p>
                  <small>${date(r.created_at)} · ${e(r.context_kind)}</small>
                </article>`,
            )
            .join("") || "<p>No eligible public reviews yet.</p>"
        }`;
    } else if (["login", "register", "recover", "reset"].includes(route))
      html = authPage(route);
    else if (administrationRoute(route))
      html =
        ["policies", "announcements"].includes(route) || user
          ? await administrationUI.render(route)
          : authPage("login");
    else if (projectRoute(route))
      html =
        route.startsWith("portfolio/") || user
          ? await projectUI.render(route)
          : authPage("login");
    else if (paymentRoute(route))
      html = user ? await paymentUI.render(route) : authPage("login");
    else if (
      route === "dashboard/messages" ||
      route === "dashboard/notifications" ||
      route.startsWith("dashboard/room/") ||
      route === "admin/learning"
    )
      html = user ? await learningUI.render(route) : authPage("login");
    else if (
      [
        "dashboard/preferences",
        "dashboard/matches",
        "dashboard/exchanges",
        "admin/exchanges",
      ].includes(route)
    )
      html = user ? await exchangeUI.render(route) : authPage("login");
    else if (route.startsWith("dashboard")) html = await dashboard(route);
    else if (route.startsWith("admin")) html = await adminPage(route);
    else html = info(route);
    $("#app").innerHTML = html;
    wire(route);
    document.querySelectorAll("header nav a").forEach((a) => {
      if (a.getAttribute("href") === "#" + route)
        a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  } catch (err) {
    $("#app").innerHTML = /* HTML */ `<div class="panel">
      <h1>We couldn't load this page.</h1>
      <p>${e(err.message)}</p>
      <a class="button" href="#home">Return home</a>
    </div>`;
  }
}
function paymentRoute(route) {
  return (
    route.startsWith("checkout/") ||
    [
      "dashboard/payments",
      "dashboard/disputes",
      "admin/payments",
      "admin/disputes",
    ].includes(route) ||
    route.startsWith("dashboard/dispute/") ||
    route.startsWith("admin/dispute/")
  );
}
function projectRoute(route) {
  return (
    [
      "dashboard/projects",
      "dashboard/portfolio",
      "dashboard/reviews",
      "dashboard/saved",
      "admin/reviews",
      "admin/portfolios",
    ].includes(route) ||
    route.startsWith("dashboard/task/") ||
    route.startsWith("portfolio/")
  );
}
function administrationRoute(route) {
  return (
    [
      "policies",
      "announcements",
      "dashboard/account",
      "dashboard/commitments",
      "dashboard/help",
      "admin/users",
      "admin/categories",
      "admin/listings",
      "admin/announcements",
      "admin/policies",
      "admin/access",
      "admin/support",
      "admin/reports",
    ].includes(route) ||
    route.startsWith("dashboard/ticket/") ||
    route.startsWith("admin/ticket/")
  );
}
const administrationUI = createAdministrationUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  money,
  user: () => user,
  shell,
  refreshUser: refresh,
  onSignedOut: async () => {
    await refresh();
    location.hash = "login";
  },
});
const projectUI = createProjectUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  user: () => user,
  shell,
  card,
});
const paymentUI = createPaymentUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  money,
  user: () => user,
  shell,
});
const learningUI = createLearningUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  user: () => user,
  shell,
});
const exchangeUI = createExchangeUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  user: () => user,
  shell,
});
function wire(route) {
  if (administrationRoute(route)) administrationUI.wire();
  if (projectRoute(route)) projectUI.wire();
  document.querySelectorAll(".save-skill").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!user) {
        location.hash = "login";
        return;
      }
      b.disabled = true;
      try {
        notice(
          (await api("/saved-skills/" + b.dataset.id, "POST", {})).message,
        );
      } catch (err) {
        notice(err.message);
      } finally {
        b.disabled = false;
      }
    }),
  );
  if (paymentRoute(route)) paymentUI.wire();
  if (
    route === "dashboard/messages" ||
    route === "dashboard/notifications" ||
    route.startsWith("dashboard/room/") ||
    route === "admin/learning"
  )
    learningUI.wire();
  if (
    [
      "dashboard/preferences",
      "dashboard/matches",
      "dashboard/exchanges",
      "admin/exchanges",
    ].includes(route)
  )
    exchangeUI.wire();
  bind("login", async (b) => {
    const r = await api("/auth/login", "POST", b);
    user = r.user;
    csrf = r.csrf;
    account();
    location.hash = user.role === "admin" ? adminHome() : "dashboard";
  });
  bind("register", async (b) => {
    const r = await api("/auth/register", "POST", {
      ...b,
      enrolled: b.enrolled === "on",
    });
    notice(r.message);
    location.hash = "login";
  });
  bind("recover", async (b) =>
    notice((await api("/auth/recover", "POST", b)).message),
  );
  bind("reset", async (b) => {
    const token = new URLSearchParams(location.hash.split("?")[1]).get("token");
    notice((await api("/auth/reset", "POST", { ...b, token })).message);
    location.hash = "login";
  });
  bind("profile", async (b) => {
    await api("/profile", "PUT", b);
    await refresh();
    notice(s.saved);
  });
  bind("verify", async (b, f) => {
    notice((await api("/verification", "POST", new FormData(f))).message);
    await refresh();
    await render();
  });
  bind("booking", async (b) => {
    if (!user) {
      location.hash = "login";
      return;
    }
    const r = await api("/bookings", "POST", b);
    notice(r.message);
    location.hash = r.booking.payment_required
      ? "checkout/" + r.booking.id
      : "dashboard/learning";
  });
  bind("listing", async (b) => {
    const body = {
      category_id: Number(b.category_id),
      title: b.title,
      description: b.description,
      level: b.level,
      objectives: b.objectives,
      prerequisites: b.prerequisites,
      duration_minutes: Number(b.duration_minutes),
      fee_minor: Math.round(Number(b.fee) * 100),
      exchange_enabled: b.exchange_enabled === "on",
      status: b.status,
    };
    await api(
      "/listings" + (b.id ? "/" + b.id : ""),
      b.id ? "PUT" : "POST",
      body,
    );
    notice(s.saved);
    location.hash = "dashboard/teaching";
  });
  document.querySelectorAll('[id^="slot-"]').forEach((f) =>
    bind(f.id, async (b) => {
      await api("/listings/" + f.id.split("-")[1] + "/slots", "POST", {
        starts_at: new Date(b.starts_at).toISOString(),
      });
      notice("Availability added.");
      f.reset();
    }),
  );
  document.querySelectorAll('[id^="decision-"]').forEach((f) =>
    bind(f.id, async (b) => {
      await api("/admin/verifications/" + f.id.split("-")[1], "POST", b);
      notice("Decision recorded.");
      await render();
    }),
  );
  $("#filters")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(ev.currentTarget))
      if (v)
        p.set(
          k === "max_bdt" ? "max_price" : k,
          k === "max_bdt" ? Math.round(Number(v) * 100) : v,
        );
    page = 1;
    const h = "explore?" + p;
    location.hash === "#" + h ? render() : (location.hash = h);
  });
  $("#prev")?.addEventListener("click", () => {
    page--;
    render();
  });
  $("#next")?.addEventListener("click", () => {
    page++;
    render();
  });
}
window.addEventListener("hashchange", () => {
  page = 1;
  render();
});
try {
  await refresh();
  categories = (await api("/categories")).items;
  await render();
} catch (err) {
  $("#app").innerHTML = /* HTML */ `<div class="panel">
    <h1>Connect your database to get started.</h1>
    <p>${e(err.message)}</p>
    <p>
      Follow README.md, apply the migration and seed the fictional data, then
      reload.
    </p>
  </div>`;
}
