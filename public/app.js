import { createAdministrationUI } from "./administration.js";
import { createProjectUI } from "./projects.js";
import { createPaymentUI } from "./payments.js";
import { createLearningUI } from "./learning.js";
import { createExchangeUI } from "./exchanges.js";
import { strings as s } from "./strings.js";

const $ = (query) => document.querySelector(query);

const e = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

let user = null;
let csrf = "";
let page = 1;
let categories = [];
let startupReady = false;
let startupError = null;
let renderVersion = 0;
let noticeTimer;

const money = (amount) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0) / 100);

const date = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: s.timezone,
  }).format(new Date(value));

const initials = (name) =>
  e(
    String(name || "Student Mentor")
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join(""),
  );

function currentRoute() {
  return location.hash.slice(1).split("?")[0] || "home";
}

async function api(url, method = "GET", body) {
  const headers = {};
  const requestMethod = method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(requestMethod);

  if (isMutation) {
    if (!csrf) {
      throw new Error(
        "Your session is not ready. Please reload the page and try again.",
      );
    }

    headers["X-CSRF-Token"] = csrf;
  }

  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch("/api" + url, {
      method: requestMethod,
      headers,
      credentials: "same-origin",
      signal: controller.signal,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      throw new Error(
        response.ok
          ? "The server returned an unexpected response. Please reload."
          : `The server could not complete this request (${response.status}).`,
      );
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request took too long. Please try again.");
    }

    if (error instanceof TypeError) {
      throw new Error(
        "Could not connect to the server. Check your connection and try again.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function notice(text) {
  const element = $("#notice");
  if (!element) return;

  clearTimeout(noticeTimer);

  element.textContent = text;
  element.style.display = "block";

  noticeTimer = setTimeout(() => {
    element.style.display = "none";
  }, 6000);
}

function account() {
  const element = $("#account");
  if (!element) return;

  element.innerHTML = user
    ? `
      <span class="name">${e(user.name.split(" ")[0])}</span>
      <a
        class="button small"
        href="#${user.role === "admin" ? adminHome() : "dashboard"}"
      >
        Dashboard
      </a>
      <button class="secondary small" id="logout" type="button">
        Sign out
      </button>
    `
    : `
      <a href="#login">Sign in</a>
      <a class="button small" href="#register">Join Skill Swap ↗</a>
    `;

  $("#logout")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      await api("/auth/logout", "POST");
      user = null;
      csrf = "";
      account();
      await refresh();

      if (currentRoute() === "home") {
        await render();
      } else {
        location.hash = "home";
      }
    } catch (error) {
      notice(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function refresh() {
  const data = await api("/auth/me");
  user = data.user;
  csrf = data.csrf;
  account();
}

const icon = `
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="m11 8-8 8 8 8m10-16 8 8-8 8M19 4l-6 24"/>
  </svg>
`;

function card(listing) {
  const description = String(listing.description || "");
  const mentorName = listing.mentor_name || user?.name || "Student Mentor";

  return `
    <article class="card">
      <div class="card-top">
        <span class="pill">${e(listing.category || "Student-led")}</span>
        <small>${e(listing.level)}</small>
      </div>

      <div
        class="skill-icon"
        data-category="${e(listing.category || "Skill session")}"
      >
        ${icon}
        <span>${e(listing.category || "Skill session")}</span>
      </div>

      <h3>
        <a href="#skill/${listing.id}">${e(listing.title)}</a>
      </h3>

      <p>
        ${e(description.slice(0, 115))}
        ${description.length > 115 ? "…" : ""}
      </p>

      <div class="mentor">
        <span class="avatar">${initials(mentorName)}</span>

        <span>
          ${
            listing.mentor_profile_public === false
              ? e(mentorName)
              : `
                <a href="#mentor/${listing.mentor_id}">
                  ${e(mentorName)}
                </a>
              `
          }
          <br>
          <small>
            Student Mentor · ${listing.duration_minutes} min
          </small>
        </span>
      </div>

      <div class="card-bottom">
        <div>
          <strong>${money(listing.fee_minor)}</strong>
          <small> / session</small>
        </div>

        ${
          listing.exchange_enabled
            ? '<span class="pill teal">Exchange available</span>'
            : ""
        }
      </div>
    </article>
  `;
}

const field = (
  name,
  label,
  type = "text",
  value = "",
  extra = "",
) => `
  <label>
    ${label}
    <input
      name="${name}"
      type="${type}"
      value="${e(value)}"
      ${extra}
      required
    >
  </label>
`;

function form(id, content, submit) {
  return `
    <form id="${id}">
      ${content}
      <button type="submit">${submit}</button>
      <p class="form-error" role="alert"></p>
    </form>
  `;
}

function bind(id, run) {
  $("#" + id)?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const element = event.currentTarget;
    const button = element.querySelector("button[type=submit]");
    const errorElement = element.querySelector(".form-error");

    if (button) button.disabled = true;
    if (errorElement) errorElement.textContent = "";

    try {
      await run(
        Object.fromEntries(new FormData(element)),
        element,
      );
    } catch (error) {
      if (errorElement) {
        errorElement.textContent = error.message;
      } else {
        notice(error.message);
      }
    } finally {
      if (button) button.disabled = false;
    }
  });
}

function can(permission) {
  return (
    user?.permissions?.includes("*") ||
    user?.permissions?.includes(permission)
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

  return `
    <div class="layout">
      <aside class="sidebar">
        ${links
          .filter(
            ([href]) =>
              !admin ||
              !adminNavigationPermissions[href] ||
              can(adminNavigationPermissions[href]),
          )
          .map(
            ([href, title]) => `
              <a
                class="${href === active ? "active" : ""}"
                href="#${href}"
                ${href === active ? 'aria-current="page"' : ""}
              >
                ${title}
              </a>
            `,
          )
          .join("")}
      </aside>

      <section>${body}</section>
    </div>
  `;
}

function home() {
  return `
    <section class="hero">
      <div>
        <div class="eyebrow">A CAMPUS FULL OF POSSIBILITIES</div>

        <h1>
          Learn something new.<br>
          <em>From someone<br>like you.</em>
        </h1>

        <p>
          Find a student who can help you take the next step.
          Book a focused session, share your own skills, or
          learn from each other through an exchange.
        </p>

        <div class="actions">
          <a class="button" href="#explore">
            Find your next skill ↗
          </a>
          <a class="button secondary" href="#exchange">
            Explore skill exchange
          </a>
        </div>

        <div class="checks">
          <span>✓ Students only</span>
          <span>✓ Practical learning</span>
        </div>
      </div>

      <div class="hero-art">
        <div class="art-top">
          <span>Better, together</span>
          <span class="exchange-tag">SKILL EXCHANGE</span>
        </div>

        <div class="mini">
          <span class="avatar">AR</span>
          <div>
            <strong>I can teach web design.</strong>
            <small>I want to learn presentation skills.</small>
          </div>
        </div>

        <div class="exchange-arrow">↕</div>

        <div class="mini">
          <span class="avatar">NA</span>
          <div>
            <strong>I can teach public speaking.</strong>
            <small>I want to build my first website.</small>
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

    <div class="grid" id="home-skills" aria-live="polite">
      <p>Loading available skills…</p>
    </div>
  `;
}

async function loadHomeSkills() {
  const container = $("#home-skills");
  if (!container) return;

  container.setAttribute("aria-busy", "true");
  container.innerHTML = "<p>Loading available skills…</p>";

  try {
    const { items } = await api("/listings");

    if ($("#home-skills") !== container) return;

    container.innerHTML = items.length
      ? items.slice(0, 6).map(card).join("")
      : `
        <div class="panel empty">
          No skills are available yet. Check back soon.
        </div>
      `;
  } catch (error) {
    if ($("#home-skills") !== container) return;

    container.innerHTML = `
      <div class="panel">
        <h3>Skills are temporarily unavailable.</h3>
        <p>${e(error.message)}</p>
        <button
          type="button"
          class="secondary"
          id="retry-home-skills"
        >
          Try again
        </button>
      </div>
    `;

    $("#retry-home-skills")?.addEventListener(
      "click",
      loadHomeSkills,
    );
  } finally {
    if ($("#home-skills") === container) {
      container.setAttribute("aria-busy", "false");
    }
  }
}

async function explore() {
  const params = new URLSearchParams(
    location.hash.split("?")[1] || "",
  );

  params.set("page", page);

  const data = await api("/listings?" + params);

  return `
    <div class="eyebrow">THE STUDENT SKILL MARKETPLACE</div>
    <h1>What will you learn next?</h1>
    <p>Real practice. A fellow student. A new possibility.</p>

    <form id="filters" class="filters">
      <label>
        Search skills
        <input
          name="q"
          value="${e(params.get("q") || "")}"
          placeholder="Try web design, English, Python…"
        >
      </label>

      <label>
        Category
        <select name="category">
          <option value="">All categories</option>

          ${categories
            .map(
              (category) => `
                <option
                  value="${category.id}"
                  ${
                    String(category.id) === params.get("category")
                      ? "selected"
                      : ""
                  }
                >
                  ${e(category.name)}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>

      <label>
        Level
        <select name="level">
          <option value="">All levels</option>

          ${["Beginner", "Intermediate", "Advanced"]
            .map(
              (level) => `
                <option
                  ${level === params.get("level") ? "selected" : ""}
                >
                  ${level}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>

      <label>
        Maximum fee (BDT)
        <input
          name="max_bdt"
          type="number"
          min="0"
          step="0.01"
          value="${
            params.has("max_price")
              ? Number(params.get("max_price")) / 100
              : ""
          }"
        >
      </label>

      <button type="submit">Search</button>
    </form>

    <p>
      ${data.total} skills available · Student identity is reviewed;
      teaching ability is not certified.
    </p>

    <div class="grid">
      ${
        data.items.map(card).join("") ||
        `
          <div class="panel empty">
            No matching skills. Try a broader search.
          </div>
        `
      }
    </div>

    <div class="pagination">
      <button
        class="secondary"
        id="prev"
        type="button"
        ${page <= 1 ? "disabled" : ""}
      >
        ← Previous
      </button>

      <span>Page ${page} of ${Math.max(1, data.pages)}</span>

      <button
        class="secondary"
        id="next"
        type="button"
        ${page >= data.pages ? "disabled" : ""}
      >
        Next →
      </button>
    </div>
  `;
}

async function detail(id) {
  const { listing, slots } = await api("/listings/" + id);

  return `
    <a href="#explore">← Explore skills</a>

    <div class="two detail">
      <section>
        <span class="pill">${e(listing.category)}</span>
        <h1>${e(listing.title)}</h1>
        <p>${e(listing.description)}</p>

        <div class="panel">
          <h2>What you'll work on</h2>
          <p>${e(listing.objectives)}</p>
          <h3>Before you start</h3>
          <p>${e(listing.prerequisites) || "No prerequisites."}</p>
        </div>

        <div class="panel">
          <h3>Your Student Mentor</h3>

          ${
            listing.mentor_profile_public === false
              ? e(listing.mentor_name)
              : `
                <a href="#mentor/${listing.mentor_id}">
                  ${e(listing.mentor_name)}
                </a>
              `
          }

          <p>${e(listing.institution)}</p>
          <p>${e(listing.bio)}</p>
          <small>${e(s.verification)}</small>
        </div>
      </section>

      <aside class="panel">
        <h2>
          ${money(listing.fee_minor)}
          <small>/ session</small>
        </h2>

        <p>
          ${listing.duration_minutes} minutes · ${e(listing.level)}
        </p>

        <span class="pill teal">
          ${
            listing.exchange_enabled
              ? "Open to skill exchange"
              : "Paid session"
          }
        </span>

        <button
          class="secondary small save-skill"
          type="button"
          data-id="${listing.id}"
        >
          Save this skill
        </button>

        <h3 class="spaced">Reserve a time</h3>
        <p>All times shown in Asia/Dhaka.</p>

        ${
          slots.length
            ? form(
                "booking",
                `
                  <label>
                    Available slot
                    <select name="slot_id">
                      ${slots
                        .map(
                          (slot) => `
                            <option value="${slot.id}">
                              ${date(slot.starts_at)}
                            </option>
                          `,
                        )
                        .join("")}
                    </select>
                  </label>
                `,
                "Reserve session",
              )
            : "<p>No available slots right now.</p>"
        }

        <div class="note">
          Paid sessions use sandbox checkout and simulated
          payment protection. No real money is charged.
        </div>
      </aside>
    </div>
  `;
}

function authPage(kind) {
  if (kind === "register") {
    return `
      <section class="panel form-panel">
        <div class="eyebrow">START WITH WHAT YOU KNOW</div>
        <h1>Join your student community.</h1>
        <p>One account to learn, teach, and exchange.</p>

        ${form(
          "register",
          field("name", "Full name") +
            field("institution", "College or university") +
            field("email", "Email address", "email") +
            field(
              "password",
              "Password (at least 12 characters)",
              "password",
              "",
              'minlength="12" maxlength="128" autocomplete="new-password"',
            ) +
            `
              <label>
                <input type="checkbox" name="enrolled" required>
                I am currently enrolled in a college or university.
                I am not registering as a professional teacher
                or coaching centre.
              </label>
            `,
          "Create account",
        )}

        <p>
          Already a member? <a href="#login">Sign in</a>
        </p>
      </section>
    `;
  }

  if (kind === "recover") {
    return `
      <section class="panel form-panel">
        <h1>Recover your account</h1>

        ${form(
          "recover",
          field("email", "Email address", "email"),
          "Send reset instructions",
        )}

        <p>
          Follow the reset instructions to choose a new password.
        </p>
      </section>
    `;
  }

  if (kind === "reset") {
    return `
      <section class="panel form-panel">
        <h1>Choose a new password</h1>

        ${form(
          "reset",
          field(
            "password",
            "New password",
            "password",
            "",
            'minlength="12" maxlength="128" autocomplete="new-password"',
          ),
          "Reset password",
        )}
      </section>
    `;
  }

  return `
    <section class="panel form-panel">
      <div class="eyebrow">WELCOME BACK</div>
      <h1>Keep your curiosity going.</h1>

      ${form(
        "login",
        field(
          "email",
          "Email address",
          "email",
          "",
          'autocomplete="username"',
        ) +
          field(
            "password",
            "Password",
            "password",
            "",
            'autocomplete="current-password"',
          ),
        "Sign in",
      )}

      <p>
        <a href="#recover">Forgot password?</a>
        ·
        <a href="#register">Create an account</a>
      </p>

      <div class="note">
        This is a student project demonstration.
        Use a provided demo account or create your own account.
        Do not upload genuine sensitive documents.
      </div>
    </section>
  `;
}

function listingForm(listing = {}) {
  return form(
    "listing",
    `
      <input type="hidden" name="id" value="${listing.id || ""}">

      ${field("title", "Skill title", "text", listing.title)}

      <label>
        Category
        <select name="category_id" required>
          ${categories
            .map(
              (category) => `
                <option
                  value="${category.id}"
                  ${category.id === listing.category_id ? "selected" : ""}
                >
                  ${e(category.name)}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>

      <label>
        Description
        <textarea name="description" required>${e(listing.description)}</textarea>
      </label>

      <label>
        Learning objectives
        <textarea name="objectives" required>${e(listing.objectives)}</textarea>
      </label>

      <label>
        Prerequisites
        <textarea name="prerequisites">${e(listing.prerequisites)}</textarea>
      </label>

      <label>
        Level
        <select name="level">
          ${["Beginner", "Intermediate", "Advanced"]
            .map(
              (level) => `
                <option ${listing.level === level ? "selected" : ""}>
                  ${level}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>

      ${field(
        "duration_minutes",
        "Duration (15–180 minutes)",
        "number",
        listing.duration_minutes || 60,
        'min="15" max="180"',
      )}

      ${field(
        "fee",
        "Session fee (BDT)",
        "number",
        (listing.fee_minor || 0) / 100,
        'min="0" max="100000" step="0.01"',
      )}

      <label>
        <input
          type="checkbox"
          name="exchange_enabled"
          ${listing.exchange_enabled !== false ? "checked" : ""}
        >
        Open to exchange
      </label>

      <label>
        Status
        <select name="status">
          ${["draft", "published", "inactive"]
            .map(
              (status) => `
                <option ${listing.status === status ? "selected" : ""}>
                  ${status}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
    `,
    "Save listing",
  );
}

async function dashboard(route) {
  if (!user) return authPage("login");

  const data = await api("/dashboard");

  const bookings = data.bookings.filter((booking) =>
    route === "dashboard/learning"
      ? booking.learner_id === user.id
      : true,
  );

  const exchangeRows = (data.exchange_sessions || [])
    .map(
      (session) => `
        <div class="row">
          <div>
            <strong>
              Exchange #${session.exchange_id}
              · ${e(session.requester_name)}
              ↔ ${e(session.recipient_name)}
            </strong>

            <p>${date(session.starts_at)} · Asia/Dhaka</p>

            <small>
              ${session.teacher_id === user.id ? "You teach" : "You learn"}
              ·
              ${
                session.teacher_completed && session.learner_confirmed
                  ? "Completed and confirmed"
                  : "Scheduled"
              }
            </small>
          </div>

          <a
            class="button secondary small"
            href="#dashboard/room/exchange/${session.exchange_id}"
          >
            Open learning room
          </a>
        </div>
      `,
    )
    .join("");

  const rows =
    bookings
      .map(
        (booking) => `
          <div class="row">
            <div>
              <strong>${e(booking.title)}</strong>
              <p>${date(booking.starts_at)} · Asia/Dhaka</p>

              <small>
                Mentor: ${e(booking.mentor_name)}
                · Learner: ${e(booking.learner_name)}
              </small>
            </div>

            <div>
              <span class="pill">
                ${e(booking.learning_status || booking.status)}
                · ${money(booking.amount_minor)}
              </span>

              <br>

              <a href="#dashboard/room/booking/${booking.id}">
                Open learning room →
              </a>

              ${
                booking.payment_required &&
                booking.learner_id === user.id
                  ? `
                    <br>
                    <a href="#checkout/${booking.id}">
                      Sandbox checkout / receipt →
                    </a>
                  `
                  : ""
              }
            </div>
          </div>
        `,
      )
      .join("") ||
    `
      <p class="empty">
        No sessions yet.
        <a href="#explore">Explore skills</a>
      </p>
    `;

  let body = "";

  if (route === "dashboard/settings") {
    body = `
      <h1>Profile & verification</h1>

      <div class="two">
        <div class="panel">
          ${form(
            "profile",
            field("name", "Name", "text", user.name) +
              field(
                "institution",
                "Institution",
                "text",
                user.institution,
              ) +
              `
                <label>
                  Introduction
                  <textarea name="bio">${e(user.bio)}</textarea>
                </label>
              `,
            "Save profile",
          )}
        </div>

        <div class="panel">
          <h2>Student verification</h2>
          <span class="pill">${e(user.verification)}</span>

          <p>
            ${e(
              data.verification?.reason ||
                "Upload your current student ID for manual review.",
            )}
          </p>

          ${
            !["approved", "pending"].includes(user.verification)
              ? form(
                  "verify",
                  `
                    <label>
                      Private student ID
                      (PDF, PNG, JPEG, max 5 MB)
                      <input
                        name="document"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        required
                      >
                    </label>
                  `,
                  "Submit student ID",
                )
              : ""
          }

          <div class="note">
            ${e(s.verification)}
            Documents are available only to you and
            authorised administrators.
          </div>
        </div>
      </div>
    `;
  } else if (
    route === "dashboard/new" ||
    route.startsWith("dashboard/edit/")
  ) {
    const listing = data.listings.find(
      (item) => item.id === Number(route.split("/")[2]),
    );

    if (route.startsWith("dashboard/edit/") && !listing) {
      throw new Error("This listing was not found in your account.");
    }

    body = `
      <h1>${listing ? "Edit" : "Create"} a skill listing</h1>
      <div class="panel">${listingForm(listing)}</div>
    `;
  } else if (route === "dashboard/teaching") {
    body = `
      <div class="section-heading">
        <h1>My teaching</h1>
        <a class="button" href="#dashboard/new">
          Create listing
        </a>
      </div>

      ${
        data.listings
          .map(
            (listing) => `
              <div class="panel">
                <div class="row">
                  <div>
                    <h3>${e(listing.title)}</h3>
                    <span class="pill">${e(listing.status)}</span>
                    ${money(listing.fee_minor)}
                  </div>

                  <a
                    class="button secondary small"
                    href="#dashboard/edit/${listing.id}"
                  >
                    Edit listing
                  </a>
                </div>

                ${form(
                  "slot-" + listing.id,
                  field(
                    "starts_at",
                    "Add availability (your device local time)",
                    "datetime-local",
                  ),
                  "Add slot",
                )}
              </div>
            `,
          )
          .join("") ||
        `
          <div class="panel empty">
            Your first listing starts here.
            Approved verification is required.
          </div>
        `
      }
    `;
  } else if (
    route === "dashboard/schedule" ||
    route === "dashboard/learning"
  ) {
    body = `
      <h1>
        ${route.endsWith("schedule") ? "Your schedule" : "My learning"}
      </h1>

      <p>All session times shown in Asia/Dhaka.</p>

      <div class="panel">${rows}</div>

      ${
        route === "dashboard/schedule"
          ? `
            <h2 class="spaced">Exchange sessions</h2>
            <div class="panel">
              ${exchangeRows || "<p>No exchange sessions yet.</p>"}
            </div>
          `
          : ""
      }
    `;
  } else {
    body = `
      <div class="eyebrow">YOUR LEARNING SPACE</div>
      <h1>Hello, ${e(user.name.split(" ")[0])}.</h1>
      <p>
        A little practice today.
        A little more possibility tomorrow.
      </p>

      <div class="stats">
        <div class="panel stat">
          LEARNING RESERVATIONS
          <strong>
            ${
              data.bookings.filter(
                (booking) => booking.learner_id === user.id,
              ).length
            }
          </strong>
          Stored bookings
        </div>

        <div class="panel stat">
          MY SKILL LISTINGS
          <strong>${data.listings.length}</strong>
          Across all statuses
        </div>

        <div class="panel stat">
          TEACHING RESERVATIONS
          <strong>
            ${
              data.bookings.filter(
                (booking) => booking.mentor_id === user.id,
              ).length
            }
          </strong>
          Stored bookings
        </div>
      </div>

      <div class="note">
        ${
          (data.exchanges || []).filter(
            (exchange) => exchange.status === "active",
          ).length
        }
        active exchanges ·

        ${
          (data.exchanges || []).filter((exchange) =>
            ["pending", "negotiating"].includes(exchange.status),
          ).length
        }
        requests or agreements awaiting action.

        <a href="#dashboard/exchanges">Open My exchanges →</a>
      </div>

      ${
        user.verification !== "approved"
          ? `
            <div class="note">
              Complete student verification to publish
              or reserve sessions.
              <a href="#dashboard/settings">
                Review your status →
              </a>
            </div>
          `
          : ""
      }

      <div class="section-heading">
        <h2>Session reservations</h2>
        <a href="#explore">Find a skill →</a>
      </div>

      <div class="panel">${rows}</div>
    `;
  }

  return shell(route, body);
}

async function adminPage(route) {
  if (!user) return authPage("login");

  if (user.role !== "admin") {
    throw new Error("Administrator access required.");
  }

  let body = "";

  if (route === "admin/verification") {
    const { items } = await api("/admin/verifications");

    body = `
      <h1>Student verification</h1>
      <p>
        Review enrolment only.
        Record a reason for every decision.
      </p>

      ${
        items
          .map(
            (verification) => `
              <div class="panel">
                <h3>
                  ${e(verification.name)}
                  <span class="pill">${e(verification.status)}</span>
                </h3>

                <p>
                  ${e(verification.email)}
                  · ${e(verification.institution)}
                </p>

                ${
                  can("files.verification")
                    ? `
                      <a
                        href="/api/files/${verification.file_id}"
                        target="_blank"
                        rel="noopener"
                      >
                        Download private student ID
                      </a>
                    `
                    : `
                      <p>
                        File access requires a separate
                        verification permission.
                      </p>
                    `
                }

                ${
                  verification.status === "pending" &&
                  can("verification.write")
                    ? form(
                        "decision-" + verification.id,
                        `
                          <label>
                            Decision
                            <select name="status">
                              <option value="approved">Approve</option>
                              <option value="rejected">Reject</option>
                            </select>
                          </label>

                          <label>
                            Reason
                            <textarea
                              name="reason"
                              minlength="5"
                              required
                            ></textarea>
                          </label>
                        `,
                        "Record decision",
                      )
                    : `<p>${e(verification.reason)}</p>`
                }
              </div>
            `,
          )
          .join("") ||
        '<div class="panel empty">No submissions yet.</div>'
      }
    `;
  } else if (route === "admin/audit") {
    const { items } = await api("/admin/audit");

    body = `
      <h1>Audit log</h1>
      <div class="panel">
        ${
          items
            .map(
              (entry) => `
                <div class="row">
                  <div>
                    <strong>
                      ${e(entry.action)} · ${e(entry.name)}
                    </strong>
                    <p>${e(entry.reason)}</p>
                    <small>
                      ${date(entry.created_at)}
                      · target ${e(entry.target)}
                    </small>
                  </div>
                </div>
              `,
            )
            .join("") || "<p>No decisions recorded.</p>"
        }
      </div>
    `;
  } else {
    const data = await api("/admin/overview");

    body = `
      <div class="eyebrow">ADMINISTRATION</div>
      <h1>Platform overview</h1>
      <p>Live counts from your database.</p>

      <div class="stats">
        ${Object.entries(data)
          .map(
            ([key, value]) => `
              <div class="panel stat">
                ${e(key.toUpperCase())}
                <strong>${e(value)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>

      ${
        can("verification.read")
          ? `
            <a class="button" href="#admin/verification">
              Review student submissions →
            </a>
          `
          : "<p>Use your permitted administration sections.</p>"
      }
    `;
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
        "Create an account and sign in. For this shared demonstration, use only fictional documents when testing Profile & verification.",
        "An administrator reviews the submission with a recorded reason.",
        "Approved students can publish skills, add availability and reserve sessions.",
      ],
      "Use the demo credentials provided by the project owner. Never upload genuine sensitive documents to a shared demonstration.",
    ],

    policies: [
      "Clear expectations. Better learning.",
      "Skill Swap is for currently enrolled college and university students.",
      [
        "Professional teachers and coaching centres may not offer services.",
        "Student verification confirms enrolment, not teaching quality. Do not share private documents in public profiles.",
        "Payments, refunds and withdrawals are sandbox simulations when enabled. Native video calling is not provided.",
      ],
      "This demonstration stores profiles, verification records, learning records and sandbox transaction history in PostgreSQL. Do not upload genuine sensitive documents to a shared demonstration.",
    ],
  };

  const [title, subtitle, steps, note] =
    content[route] || content.help;

  return `
    <div class="intro">
      <div class="eyebrow">
        SKILL SWAP / ${e(route.toUpperCase())}
      </div>

      <h1>${e(title)}</h1>
      <p>${e(subtitle)}</p>

      ${steps
        .map(
          (step, index) => `
            <div class="panel">
              <span class="eyebrow">
                ${String(index + 1).padStart(2, "0")}
              </span>
              <p>${e(step)}</p>
            </div>
          `,
        )
        .join("")}

      <div class="note">${e(note)}</div>

      <div class="actions">
        <a class="button" href="#explore">Explore skills →</a>

        ${
          route === "exchange"
            ? `
              <a
                class="button secondary"
                href="#dashboard/preferences"
              >
                Set up your exchange →
              </a>
            `
            : ""
        }
      </div>
    </div>
  `;
}

async function mentorPage(id) {
  const data = await api("/mentors/" + id);
  const averageRating = data.statistics.average_rating;

  return `
    <span class="avatar">${initials(data.mentor.name)}</span>
    <h1>${e(data.mentor.name)}</h1>
    <p>${e(data.mentor.institution)}</p>
    <p>${e(data.mentor.bio)}</p>

    <div class="note">${e(s.verification)}</div>

    <div class="stats">
      <div class="panel stat">
        CONFIRMED TEACHING SESSIONS
        <strong>${data.statistics.completed_sessions}</strong>
        Bookings and exchange sessions
      </div>

      <div class="panel stat">
        ELIGIBLE PUBLIC REVIEWS
        <strong>${data.statistics.review_count}</strong>
        ${
          averageRating === null || averageRating === undefined
            ? "No ratings yet"
            : Number(averageRating).toFixed(1) + " / 5 average"
        }
      </div>
    </div>

    <h2>Skills from this Student Mentor</h2>

    <div class="grid">
      ${
        data.listings
          .map((listing) =>
            card({
              ...listing,
              mentor_name: data.mentor.name,
            }),
          )
          .join("") || "<p>No published listings.</p>"
      }
    </div>

    <h2 class="spaced">Student portfolio</h2>

    <div class="grid">
      ${
        data.portfolio
          .map(
            (project) => `
              <article class="panel">
                <span class="pill">
                  ${
                    project.reviewed_project
                      ? "Reviewed task"
                      : "Independent work"
                  }
                </span>

                <h3 class="spaced">
                  <a href="#portfolio/${project.id}">
                    ${e(project.title)}
                  </a>
                </h3>

                <p>
                  ${e(String(project.description || "").slice(0, 180))}
                </p>

                <a href="#portfolio/${project.id}">
                  View project →
                </a>
              </article>
            `,
          )
          .join("") || "<p>No public portfolio work yet.</p>"
      }
    </div>

    <h2 class="spaced">Participant reviews</h2>

    ${
      data.reviews
        .map(
          (review) => `
            <article class="panel exchange-card">
              <h3>
                ${e(review.author_name)} · ${review.rating}/5
              </h3>
              <p>${e(review.comment)}</p>
              <small>
                ${date(review.created_at)}
                · ${e(review.context_kind)}
              </small>
            </article>
          `,
        )
        .join("") || "<p>No eligible public reviews yet.</p>"
    }
  `;
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

function learningRoute(route) {
  return (
    route === "dashboard/messages" ||
    route === "dashboard/notifications" ||
    route.startsWith("dashboard/room/") ||
    route === "admin/learning"
  );
}

function exchangeRoute(route) {
  return [
    "dashboard/preferences",
    "dashboard/matches",
    "dashboard/exchanges",
    "admin/exchanges",
  ].includes(route);
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

function isImmediatePublicRoute(route) {
  return ["home", "exchange", "help"].includes(route);
}

async function render() {
  const version = ++renderVersion;
  const route = currentRoute();
  const app = $("#app");

  if (!app) return;

  if (!startupReady && !isImmediatePublicRoute(route)) {
    app.innerHTML = `
      <div class="panel" role="status">
        <p>Preparing your session…</p>
      </div>
    `;
    return;
  }

  if (
    startupError &&
    !["home", "exchange", "help"].includes(route)
  ) {
    app.innerHTML = `
      <div class="panel">
        <h1>We couldn't finish loading this page.</h1>
        <p>${e(startupError.message)}</p>
        <button type="button" id="retry-startup">
          Reload page
        </button>
      </div>
    `;

    $("#retry-startup")?.addEventListener("click", () => {
      location.reload();
    });

    return;
  }

  if (route !== "home") {
    app.innerHTML = '<p role="status">Loading…</p>';
  }

  try {
    let html;

    if (route === "home") {
      html = home();
    } else if (route === "explore") {
      html = await explore();
    } else if (route.startsWith("skill/")) {
      html = await detail(route.split("/")[1]);
    } else if (route.startsWith("mentor/")) {
      html = await mentorPage(route.split("/")[1]);
    } else if (
      ["login", "register", "recover", "reset"].includes(route)
    ) {
      html = authPage(route);
    } else if (administrationRoute(route)) {
      html =
        ["policies", "announcements"].includes(route) || user
          ? await administrationUI.render(route)
          : authPage("login");
    } else if (projectRoute(route)) {
      html =
        route.startsWith("portfolio/") || user
          ? await projectUI.render(route)
          : authPage("login");
    } else if (paymentRoute(route)) {
      html = user
        ? await paymentUI.render(route)
        : authPage("login");
    } else if (learningRoute(route)) {
      html = user
        ? await learningUI.render(route)
        : authPage("login");
    } else if (exchangeRoute(route)) {
      html = user
        ? await exchangeUI.render(route)
        : authPage("login");
    } else if (route.startsWith("dashboard")) {
      html = await dashboard(route);
    } else if (route.startsWith("admin")) {
      html = await adminPage(route);
    } else {
      html = info(route);
    }

    if (version !== renderVersion) return;

    app.innerHTML = html;
    wire(route);

    if (route === "home") {
      void loadHomeSkills();
    }

    document.querySelectorAll("header nav a").forEach((link) => {
      if (link.getAttribute("href") === "#" + route) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    window.scrollTo(0, 0);
  } catch (error) {
    if (version !== renderVersion) return;

    app.innerHTML = `
      <div class="panel">
        <h1>We couldn't load this page.</h1>
        <p>${e(error.message)}</p>
        <button type="button" id="retry-page">Try again</button>
        <a class="button secondary" href="#home">Return home</a>
      </div>
    `;

    $("#retry-page")?.addEventListener("click", () => {
      void render();
    });
  }
}

function wire(route) {
  if (administrationRoute(route)) {
    administrationUI.wire();
  }

  if (projectRoute(route)) {
    projectUI.wire();
  }

  if (paymentRoute(route)) {
    paymentUI.wire();
  }

  if (learningRoute(route)) {
    learningUI.wire();
  }

  if (exchangeRoute(route)) {
    exchangeUI.wire();
  }

  document.querySelectorAll(".save-skill").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!user) {
        location.hash = "login";
        return;
      }

      button.disabled = true;

      try {
        const result = await api(
          "/saved-skills/" + button.dataset.id,
          "POST",
          {},
        );

        notice(result.message);
      } catch (error) {
        notice(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });

  bind("login", async (body) => {
    const result = await api("/auth/login", "POST", body);

    user = result.user;
    csrf = result.csrf;

    account();

    location.hash =
      user.role === "admin" ? adminHome() : "dashboard";
  });

  bind("register", async (body) => {
    const result = await api("/auth/register", "POST", {
      ...body,
      enrolled: body.enrolled === "on",
    });

    notice(result.message);
    location.hash = "login";
  });

  bind("recover", async (body) => {
    const result = await api("/auth/recover", "POST", body);
    notice(result.message);
  });

  bind("reset", async (body) => {
    const token = new URLSearchParams(
      location.hash.split("?")[1],
    ).get("token");

    const result = await api("/auth/reset", "POST", {
      ...body,
      token,
    });

    notice(result.message);
    location.hash = "login";
  });

  bind("profile", async (body) => {
    await api("/profile", "PUT", body);
    await refresh();
    notice(s.saved);
  });

  bind("verify", async (body, element) => {
    const result = await api(
      "/verification",
      "POST",
      new FormData(element),
    );

    notice(result.message);

    await refresh();
    await render();
  });

  bind("booking", async (body) => {
    if (!user) {
      location.hash = "login";
      return;
    }

    const result = await api("/bookings", "POST", body);

    notice(result.message);

    location.hash = result.booking.payment_required
      ? "checkout/" + result.booking.id
      : "dashboard/learning";
  });

  bind("listing", async (body) => {
    const payload = {
      category_id: Number(body.category_id),
      title: body.title,
      description: body.description,
      level: body.level,
      objectives: body.objectives,
      prerequisites: body.prerequisites,
      duration_minutes: Number(body.duration_minutes),
      fee_minor: Math.round(Number(body.fee) * 100),
      exchange_enabled: body.exchange_enabled === "on",
      status: body.status,
    };

    await api(
      "/listings" + (body.id ? "/" + body.id : ""),
      body.id ? "PUT" : "POST",
      payload,
    );

    notice(s.saved);
    location.hash = "dashboard/teaching";
  });

  document.querySelectorAll('[id^="slot-"]').forEach((element) => {
    bind(element.id, async (body) => {
      await api(
        "/listings/" + element.id.split("-")[1] + "/slots",
        "POST",
        {
          starts_at: new Date(body.starts_at).toISOString(),
        },
      );

      notice("Availability added.");
      element.reset();
    });
  });

  document
    .querySelectorAll('[id^="decision-"]')
    .forEach((element) => {
      bind(element.id, async (body) => {
        await api(
          "/admin/verifications/" + element.id.split("-")[1],
          "POST",
          body,
        );

        notice("Decision recorded.");
        await render();
      });
    });

  $("#filters")?.addEventListener("submit", (event) => {
    event.preventDefault();

    const params = new URLSearchParams();

    for (const [key, value] of new FormData(event.currentTarget)) {
      if (value !== "") {
        params.set(
          key === "max_bdt" ? "max_price" : key,
          key === "max_bdt"
            ? Math.round(Number(value) * 100)
            : value,
        );
      }
    }

    page = 1;

    const hash = "explore?" + params;

    if (location.hash === "#" + hash) {
      void render();
    } else {
      location.hash = hash;
    }
  });

  $("#prev")?.addEventListener("click", () => {
    page = Math.max(1, page - 1);
    void render();
  });

  $("#next")?.addEventListener("click", () => {
    page += 1;
    void render();
  });
}

window.addEventListener("hashchange", () => {
  page = 1;
  void render();
});

async function start() {
  const firstRoute = currentRoute();

  account();

  if (isImmediatePublicRoute(firstRoute)) {
    await render();
  } else {
    $("#app").innerHTML = `
      <div class="panel" role="status">
        <p>Preparing your session…</p>
      </div>
    `;
  }

  try {
    const results = await Promise.allSettled([
      refresh(),
      api("/categories"),
    ]);

    const sessionResult = results[0];
    const categoryResult = results[1];

    if (categoryResult.status === "fulfilled") {
      categories = categoryResult.value.items;
    }

    if (sessionResult.status === "rejected") {
      throw sessionResult.reason;
    }

    if (categoryResult.status === "rejected") {
      throw categoryResult.reason;
    }

    startupReady = true;

    const route = currentRoute();

    if (!isImmediatePublicRoute(route)) {
      await render();
    }
  } catch (error) {
    startupReady = true;
    startupError = error;

    if (isImmediatePublicRoute(currentRoute())) {
      notice(
        "Some account or category information could not be loaded. Reload the page before signing in or booking.",
      );
    } else {
      await render();
    }
  }
}

void start();