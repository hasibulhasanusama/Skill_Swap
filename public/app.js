import { createArenaUI } from "./arena.js";
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
  const timeout = setTimeout(() => controller.abort(), url.startsWith("/arena/") && (url.endsWith("/generate") || url.endsWith("/answer") || url.endsWith("/task")) ? 120000 : 20000);

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
      
      
<div class="ss-notification-wrap">
  <button type="button"
        id="ss-notification-bell"
        class="ss-notification-bell"
        aria-label="Notifications" aria-expanded="false" aria-controls="ss-notification-popup"
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.7"
          stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>
          <path d="M10 21h4"/>
        </svg>
        <span id="ss-notification-count"
          class="ss-notification-count" hidden></span>
      </button>
  <div id="ss-notification-popup" hidden>
    <div class="ss-notification-heading">
      <strong>Notifications</strong>
      <button type="button" id="ss-notification-refresh">Refresh</button>
    </div>
    <div id="ss-notification-items" role="region"
      aria-label="Recent notifications" aria-live="polite"></div>
  </div>
</div>

      <details class="ss-account-menu">
        <summary aria-label="Open account menu">
          <span class="ss-profile-avatar">
            ${user.has_avatar
              ? '<img src="/api/profile/avatar?v=' + encodeURIComponent(user.avatar_updated_at || "") + '" alt="Profile picture">'
              : e(user.name.trim().charAt(0).toUpperCase())}
          </span>
        </summary>

        <div class="ss-account-dropdown">
          <strong>${e(user.name)}</strong>
          <a href="#dashboard/settings">Profile</a>
          <a href="#${user.role === "admin" ? adminHome() : "dashboard"}">Dashboard</a>
          <a href="#dashboard/notifications">Notifications</a>
          <a href="#dashboard/account">Settings</a>
          <button id="logout" type="button">Logout</button>
        </div>
      </details>
    `
    : `
      <a href="#login">Sign in</a>
      <a class="button small" href="#register">Join Skill Swap</a>
    `;

  void updateNotificationBadge();

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
  "arena/admin": "arena.manage",
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

  // Standalone teaching and exchange pages
  const standalonePages = [
    "dashboard/new",
    "dashboard/matches",
    "dashboard/preferences"
  ];

  if (!admin && user?.role !== "admin" &&
      standalonePages.includes(active)) {
    return '<section class="ss-standalone-page">' + body + '</section>';
  }



  const profileRoutes = [
    "dashboard/settings",
    "dashboard/messages"
  ];

  const settingsRoutes = [
    "dashboard/account",
    "dashboard/help"
  ];

  const studentLinks = profileRoutes.includes(active)
    ? [
        ["dashboard/settings", "Profile & Verification"],
        ["dashboard/messages", "Messages"]
      ]
    : settingsRoutes.includes(active)
      ? [
          ["dashboard/account", "Account & Privacy"],
          ["dashboard/help", "Help & Support"]
        ]
      : active === "dashboard/notifications"
        ? [
            ["dashboard/notifications", "Notifications"]
          ]
        : [
            ["dashboard", "Overview"],
            ["dashboard/learning", "My Learning"],
            ["dashboard/teaching", "My Teaching"],
            ["dashboard/schedule", "Schedule"],
            ["dashboard/exchanges", "My Exchanges"],
            ["arena", "Skill Arena & Results"],
            ["dashboard/payments", "Payments & Earnings"],
            ["dashboard/disputes", "Payment Complaints"],
            ["dashboard/projects", "Exercises & Projects"],
            ["dashboard/portfolio", "My Portfolio and Skills"],
            ["dashboard/reviews", "Reviews"]
          ];

  // Separate administrator navigation
  const isAdministrator = user?.role === "admin";
  if (isAdministrator) admin = true;

  const adminProfile = active === "dashboard/settings";
  const adminSettings = [
    "dashboard/account",
    "dashboard/help",
    "admin/access"
  ].includes(active);

  const adminNotifications = active === "dashboard/notifications";

  const adminLinks = adminProfile
    ? [
        ["dashboard/settings", "My Profile"]
      ]
    : adminSettings
      ? [
          ["dashboard/account", "Account & Privacy"],
          ["dashboard/help", "Help & Support"],
          ["admin/access", "Roles & Access"]
        ]
      : adminNotifications
        ? [
            ["dashboard/notifications", "Notifications"]
          ]
        : [
            ["admin", "Overview"],
            ["admin/users", "Students"],
            ["admin/listings", "Skill Listings"],
            ["admin/categories", "Categories"],
            ["admin/verification", "Verification"],
            ["admin/payments", "Payments & Withdrawals"],
            ["admin/disputes", "Payment Complaints"],
            ["admin/support", "Support Requests"],
            ["admin/reports", "Reports"],
            ["admin/audit", "Audit Log"],
            ["arena/admin", "Game PDF Library"]
          ];

  // Keep the current management page reachable when opened by a direct link.
  const extraAdminPages = {
    "admin/exchanges": "Exchanges & Reports",
    "admin/learning": "Session Inspection",
    "admin/reviews": "Review Moderation",
    "admin/portfolios": "Portfolio Moderation",
    "admin/announcements": "Announcements",
    "admin/policies": "Policy Settings"
  };

  if (extraAdminPages[active]) {
    adminLinks.push([active, extraAdminPages[active]]);
  }

  const links = admin ? adminLinks : studentLinks;

  if (isAdministrator && adminProfile) {
    const page = new DOMParser().parseFromString(body, "text/html");

    for (const heading of page.querySelectorAll("h2")) {
      if (heading.textContent.trim() === "Student verification") {
        heading.closest(".panel")?.remove();
      }
    }

    for (const link of page.querySelectorAll('a[href="#dashboard/messages"]')) {
      link.remove();
    }

    const columns = page.querySelector(".two");
    if (columns && columns.children.length === 1) {
      columns.classList.remove("two");
    }

    body = page.body.innerHTML;
  }


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
    <div class="ss-home">
      <section
        class="ss-home-hero"
        aria-labelledby="ss-home-title"
      >
        <div class="ss-home-intro">
          <span class="ss-home-eyebrow">
            A COMMUNITY BUILT ON SHARED KNOWLEDGE
          </span>

          <h1 id="ss-home-title">
            Something you know.<br>
            Something they need.<br>
            <em>A chance to grow together.</em>
          </h1>

          <p>
            You do not need to know everything to help
            someone get started. Learn from a fellow student,
            share what you know, and take the next step together.
          </p>
        </div>

        
<div class="ss-home-conversation">
          <div class="ss-home-conversation-heading">
            <span
              class="ss-home-status-dot"
              aria-hidden="true"
            ></span>

            Good learning starts with a conversation
          </div>

          <div class="ss-home-messages">
            <article
              class="ss-home-message ss-home-message-learn"
            >
              <span
                class="ss-home-avatar"
                aria-hidden="true"
              >
                L
              </span>

              <div>
                <span class="ss-home-message-label">
                  I WANT TO LEARN
                </span>

                <h2>
                  “Can someone help me build my first website?”
                </h2>

                <p>
                  I know the basics.
                  I just need a little guidance.
                </p>
              </div>
            </article>

            <div
              class="ss-home-connection"
              aria-hidden="true"
            >
            </div>

            <article
              class="ss-home-message ss-home-message-teach"
            >
              <span
                class="ss-home-avatar"
                aria-hidden="true"
              >
                T
              </span>

              <div>
                <span class="ss-home-message-label">
                  I WANT TO TEACH
                </span>

                <h2>
                  “I can help.
                  Let’s build something together.”
                </h2>

                <p>
                  We can start small and practise
                  one step at a time.
                </p>
              </div>
            </article>
          </div>

        </div>
      </section>

      <section
        class="ss-home-paths" id="ss-home-skills"
        aria-labelledby="ss-home-path-title"
      >
        <div class="ss-home-section-intro">


          <h2 id="ss-home-path-title">
                       Learn,Teach & Grow Together
          </h2>

        </div>

        <div class="ss-home-path-grid">
          <article class="ss-home-path ss-home-path-learn">
            <div class="ss-home-path-top">
              <span class="ss-home-path-number">
                
              </span>
            </div>

            <h3>Learn Skills</h3>

            <p>
              Find something you want to learn,
              book a session, and turn your curiosity
              into something you can do.
            </p>

            <a class="button" href="#explore">
              Start learning →
            </a>

            <nav
              class="ss-home-path-links"
              aria-label="Learning shortcuts"
            >
            </nav>
          </article>

          <article class="ss-home-path ss-home-path-teach">
            <div class="ss-home-path-top">
              <span class="ss-home-path-number">
                
              </span>
            </div>

            <h3>Teach Skills</h3>

            <p>
              Share something you know,
              create a skill listing, and help
              another student take their first step.
            </p>

            <a class="button" href="#dashboard/new">
              Start teaching →
            </a>

            <nav
              class="ss-home-path-links"
              aria-label="Teaching shortcuts"
            >
            </nav>
          </article>
        
          <article class="ss-home-path ss-home-path-exchange">
            

            <h3>Exchange Skills</h3>

            <p>
              Teach what you know and learn something new
              in return. Explore skill exchanges with
              fellow students, without paying a fee.
            </p>

            <a class="button" href="#dashboard/matches">Start Exchange &rarr;</a>

            
          </article>


  <div class="ss-home-section-intro ss-home-game-heading">
    <h2 id="ss-home-game-title">Play, Practice &amp; Grow Together</h2>
  </div>
  <article class="arena-game-card arena-detective">
<span class="arena-game-icon" aria-hidden="true">01</span><span class="arena-kicker">STUDY &amp; SOLVE</span><h3>Skill Detective</h3><p>Study a PDF, spot the mistake and discover why. Play solo, against a bot or with friends.</p><a class="button" href="#arena/detective">Play Detective &rarr;</a></article>
<article class="arena-game-card arena-relay"><span class="arena-game-icon" aria-hidden="true">02</span><span class="arena-kicker">SET &amp; SOLVE</span><h3>Code Relay</h3><p>Set a coding problem. Solve your friends’ questions. Take turns and race the clock.</p><a class="button" href="#arena/relay">Start Code Relay &rarr;</a></article>
<article class="arena-game-card arena-typing"><span class="arena-game-icon" aria-hidden="true">03</span><span class="arena-kicker">TYPE &amp; RACE</span><h3>TypeSprint</h3><p>Build typing speed and accuracy in Bangla, English or code. Race a friend or a practice bot.</p><a class="button" href="#arena/typing">Start TypeSprint &rarr;</a></article>
</div>

        <p class="ss-home-account-note">
          Sign in to access your learning and teaching tools.
          Student verification is required to publish
          or book sessions.
        </p>
      </section>

      
      
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

      <button type="submit" class="skill-search-button">Search</button>
    </form>

    <p>
      
      
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
      <h1>My Profile</h1>

      <div class="panel ss-profile-card">
        <span class="ss-profile-avatar ss-profile-avatar-large">
          ${user.has_avatar
            ? '<img src="/api/profile/avatar?v=' + encodeURIComponent(user.avatar_updated_at || "") + '" alt="Profile picture">'
            : e(user.name.trim().charAt(0).toUpperCase())}
        </span>

        <div class="ss-profile-details">
          <h2>${e(user.name)}</h2>
          <p>${e(user.institution || "")}</p>
          
        </div>

        <div class="ss-photo-actions">
          ${form(
            "avatar-upload",
            '<label>Profile picture (PNG/JPEG, max 5 MB)<input name="avatar" type="file" accept="image/png,image/jpeg" required></label>',
            "Upload picture"
          )}
          ${user.has_avatar
            ? form("avatar-remove", "", "Remove picture")
            : ""}
        </div>
      </div>

      <div class="two">
        <div class="panel">
          ${form(
            "profile",
            field("name", "Name", "text", user.name) +
              field("phone", "Phone number", "tel", user.phone || "") +
              field("age", "Age", "number", user.age ?? "", 'min="1" max="120" step="1"') +
              field("email", "Email address", "email", user.email, 'required autocomplete="email"') +
              `
                <label>
                  Gender
                  <select name="gender">
                    <option value="" ${!user.gender ? "selected" : ""}>Select gender</option>
                    <option value="male" ${user.gender === "male" ? "selected" : ""}>Male</option>
                    <option value="female" ${user.gender === "female" ? "selected" : ""}>Female</option>
                  </select>
                </label>
              ` +

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
          <span class="pill">${e(
            data.verification?.reason?.startsWith("Demo approval:")
              ? "Demo approved"
              : user.verification
          )}</span>

          <p>
            ${e(
              data.verification?.reason ||
                "Enter your Student ID and upload an ID card for automatic demo approval. Identity is not authenticated.",
            )}
          </p>

          ${
            user.role === "student" /* verification-resubmit */
              ? form(
                  "verify",
                  `
                    
                    <label>
                      Student ID
                      <input
                        name="student_id"
                        type="text"
                        value="${e(user.student_id || "")}"
                        placeholder="242-35-350"
                        pattern="[0-9]{3}-[0-9]{2}-[0-9]{3}"
                        title="Use this format: 242-35-350"
                        maxlength="10"
                        required
                      >
                    </label>

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
                  "Submit / Update demo verification",
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
      <h1>Hello, ${e(user.name)}.</h1>
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
        ${route === "help" ? '<section id="ss-help-chat"></section>' : '<a class="button" href="#explore">Explore skills</a>'}

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

const arenaUI = createArenaUI({ api, e, notice, user: () => user });

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

    arenaUI.stop();
    if (route === "arena" || route.startsWith("arena/")) {
      html = user ? await arenaUI.render(route) : authPage("login");
    } else if (route === "home") {
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
    window.dispatchEvent(new Event("ss-page-ready"));
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
  if (route === "arena" || route.startsWith("arena/")) arenaUI.wire();
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

  bind("avatar-upload", async (body, element) => {
    const input = element.querySelector('input[name="avatar"]');
    const picture = input.files[0];

    if (!picture) throw new Error("Choose a picture.");
    if (picture.size > 5 * 1024 * 1024) {
      throw new Error("Picture must be 5 MB or smaller.");
    }

    await api("/profile/avatar", "POST", new FormData(element));
    await refresh();
    account();
    await render();
    notice("Profile picture updated.");
  });

  bind("avatar-remove", async () => {
    await api("/profile/avatar", "DELETE");
    await refresh();
    account();
    await render();
    notice("Profile picture removed.");
  });

  bind("profile", async (body) => {
    const result = await api("/profile", "PUT", body);
    user = result.user;
    account();
    await render();
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

// SS HOME SCROLL START
let ssHomeScrollObserver = null;
let ssHomeScrollFrame = null;

function ssScrollToHomeSkills() {
  ssHomeScrollObserver?.disconnect();
  ssHomeScrollObserver = null;

  if (ssHomeScrollFrame !== null) {
    cancelAnimationFrame(ssHomeScrollFrame);
    ssHomeScrollFrame = null;
  }

  if (location.hash !== "#home?section=skills") return;

  const appContainer = document.querySelector("#app");
  if (!appContainer) return;

  const findAndScroll = () => {
    if (location.hash !== "#home?section=skills") {
      ssHomeScrollObserver?.disconnect();
      ssHomeScrollObserver = null;
      return;
    }

    const target = document.getElementById("ss-home-skills");
    if (!target) return;

    ssHomeScrollObserver?.disconnect();
    ssHomeScrollObserver = null;

    ssHomeScrollFrame = requestAnimationFrame(() => {
      ssHomeScrollFrame = requestAnimationFrame(() => {
        ssHomeScrollFrame = null;

        if (
          location.hash !== "#home?section=skills" ||
          !target.isConnected
        ) {
          return;
        }

        target.scrollIntoView({
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      });
    });
  };

  ssHomeScrollObserver = new MutationObserver(findAndScroll);
  ssHomeScrollObserver.observe(appContainer, {
    childList: true,
    subtree: true,
  });

  findAndScroll();
}

window.addEventListener("hashchange", ssScrollToHomeSkills);

document.addEventListener("click", (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const link = event.target instanceof Element
    ? event.target.closest(
        'header nav a[href="#home?section=skills"]'
      )
    : null;

  if (link && location.hash === "#home?section=skills") {
    event.preventDefault();
    ssScrollToHomeSkills();
  }
});

ssScrollToHomeSkills();
// SS HOME SCROLL END


// Header unread notification count
let notificationBadgeBusy = false;

async function updateNotificationBadge() {
  const badge = document.getElementById("ss-notification-count");
  const bell = document.getElementById("ss-notification-bell");

  if (!user || !badge || !bell || notificationBadgeBusy) return;

  const accountId = user.id;
  notificationBadgeBusy = true;

  try {
    const result = await api("/notifications");
    if (!user || user.id !== accountId || !badge.isConnected) return;

    const unread = Math.max(0, Number(result.unread) || 0);
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.hidden = unread === 0;
    bell.setAttribute(
      "aria-label",
      unread ? "Notifications: " + unread + " unread" : "Notifications"
    );
    bell.title = unread ? unread + " unread notifications" : "Notifications";
  } catch {
    // Keep the last count when a background refresh fails.
  } finally {
    notificationBadgeBusy = false;
  }
}

setInterval(() => {
  if (!document.hidden) void updateNotificationBadge();
}, 30000);

window.addEventListener("focus", () => {
  void updateNotificationBadge();
});

window.addEventListener("hashchange", () => {
  void updateNotificationBadge();
});

// Refresh after marking a notification as read.
document.addEventListener("click", event => {
  if (event.target instanceof Element &&
      event.target.closest(".notification-read")) {
    setTimeout(() => void updateNotificationBadge(), 1200);
  }
});


// Header notification dropdown
async function loadNotificationDropdown() {
  const list = document.getElementById("ss-notification-items");
  if (!list || !user) return;
  const accountId = user.id;
  list.textContent = "Loading notifications...";

  try {
    const data = await api("/notifications");
    if (!list.isConnected || user?.id !== accountId) return;

    const items = (data.items || []).slice(0, 15);
    list.innerHTML = items.length
      ? items.map(n => `
        <article class="ss-notification-item ${n.read_at ? "" : "is-unread"}">
          <strong>${e(n.title)}</strong>
          <small>${e(date(n.created_at))}</small>
          <div class="ss-notification-actions">
            <a href="#${e(n.route)}">View details</a>
            ${n.read_at
              ? '<span>Read</span>'
              : '<button type="button" data-ss-notification-read="' + Number(n.id) + '">Mark read</button>'}
          </div>
        </article>
      `).join("")
      : '<p class="ss-notification-empty">No notifications yet.</p>';

    void updateNotificationBadge();
  } catch (error) {
    if (list.isConnected && user?.id === accountId) {
      list.textContent = error.message;
    }
  }
}

function closeNotificationDropdown() {
  const popup = document.getElementById("ss-notification-popup");
  if (popup) popup.hidden = true;
  document.getElementById("ss-notification-bell")
    ?.setAttribute("aria-expanded", "false");
}

document.addEventListener("click", async event => {
  if (!(event.target instanceof Element)) return;
  const target = event.target;
  const popup = document.getElementById("ss-notification-popup");
  const bell = document.getElementById("ss-notification-bell");

  if (target.closest("#ss-notification-bell")) {
    if (!popup || !bell) return;
    popup.hidden = !popup.hidden;
    bell.setAttribute("aria-expanded", String(!popup.hidden));
    if (!popup.hidden) {
      document.querySelector(".ss-account-menu")?.removeAttribute("open");
      await loadNotificationDropdown();
    }
    return;
  }

  if (target.closest("#ss-notification-refresh")) {
    await loadNotificationDropdown();
    return;
  }

  const readButton = target.closest("[data-ss-notification-read]");
  if (readButton) {
    readButton.disabled = true;
    try {
      await api("/notifications/" + readButton.dataset.ssNotificationRead + "/read", "POST", {});
      await loadNotificationDropdown();
    } catch (error) {
      notice(error.message);
    } finally {
      readButton.disabled = false;
    }
    return;
  }

  if (!target.closest(".ss-notification-wrap") ||
      target.closest("#ss-notification-popup a")) {
    closeNotificationDropdown();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    const popup = document.getElementById("ss-notification-popup");
    if (popup && !popup.hidden) {
      closeNotificationDropdown();
      document.getElementById("ss-notification-bell")?.focus();
    }
  }
});

window.addEventListener("hashchange", closeNotificationDropdown);


// Close profile menu on outside click
document.addEventListener("click", event => {
  const menu = document.querySelector("#account .ss-account-menu");
  if (!menu || !(event.target instanceof Node)) return;

  if (!menu.contains(event.target) ||
      (event.target instanceof Element &&
       event.target.closest(".ss-account-dropdown a"))) {
    menu.removeAttribute("open");
  }
});

document.addEventListener("keydown", event => {
  const menu = document.querySelector("#account .ss-account-menu");
  if (event.key === "Escape" && menu?.open) {
    menu.removeAttribute("open");
    menu.querySelector("summary")?.focus();
  }
});

window.addEventListener("hashchange", () => {
  document.querySelector("#account .ss-account-menu")
    ?.removeAttribute("open");
});


// Inline Help support chat
function mountHelpChat() {
  const root = document.getElementById("ss-help-chat");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "true";

  if (!user) {
    root.innerHTML = '<h2>Message Support</h2><p>Sign in to send a message and receive replies.</p><a class="button" href="#login">Sign in</a>';
    // Retry after the login session has loaded.
    root.dataset.ready = "";
    return;
  }

  const accountId = user.id;
  let selected = null;
  let busy = false;
  let loaded = false;

  root.innerHTML =
    '<div class="ss-support-heading"><div><h2>Message Support</h2><p>Send a message. Read the admin reply here.</p></div><button type="button" id="ss-support-refresh" class="secondary small">Refresh</button></div>' +
    '<label>Your conversations<select id="ss-support-select"><option value="">New conversation</option></select></label>' +
    '<div id="ss-support-thread" role="log" aria-label="Support conversation"></div>' +
    '<form id="ss-support-form"><label id="ss-support-subject-label">Subject<input name="subject" minlength="2" maxlength="120" required placeholder="What do you need help with?"></label>' +
    '<label>Message<textarea name="body" minlength="10" maxlength="6000" required rows="3" placeholder="Describe your question (at least 10 characters)"></textarea></label>' +
    '<p id="ss-support-error" role="status"></p><button type="submit">Send message</button></form>';

  const select = root.querySelector("#ss-support-select");
  const thread = root.querySelector("#ss-support-thread");
  const formElement = root.querySelector("#ss-support-form");
  const subjectLabel = root.querySelector("#ss-support-subject-label");
  const subject = formElement.elements.subject;
  const errorBox = root.querySelector("#ss-support-error");

  function alive() {
    return root.isConnected && user?.id === accountId;
  }

  async function reload() {
    if (busy || !alive()) return;
    busy = true;

    try {
      const data = await api("/support/tickets");
      if (!alive()) return;

      const tickets = data.items || [];
      if (!loaded) {
        const params = new URLSearchParams(location.hash.split("?")[1] || "");
        const requested = Number(params.get("ticket"));
        selected = tickets.some(t => t.id === requested)
          ? requested
          : (tickets[0]?.id || null);
        loaded = true;
      }

      select.innerHTML = '<option value="">New conversation</option>' +
        tickets.map(t =>
          '<option value="' + Number(t.id) + '">' +
          e(t.subject) + ' ? ' + e(t.status) + '</option>'
        ).join("");
      select.value = selected ? String(selected) : "";

      if (!selected) {
        thread.innerHTML = '<p class="ss-support-empty">Write a message below to start a conversation.</p>';
        subjectLabel.hidden = false;
        subject.required = true;
        formElement.hidden = false;
        return;
      }

      const conversationId = selected;
      const detail = await api("/support/tickets/" + conversationId);
      if (!alive() || selected !== conversationId) return;

      const ticket = detail.ticket;
      const messages = [{
        author_id: ticket.user_id,
        name: "You",
        body: ticket.body,
        created_at: ticket.created_at
      }].concat(detail.replies || []);

      const previousScroll = thread.scrollTop;
      const nearBottom =
        thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
      const previous = thread.innerHTML;

      const html = messages.map(m =>
        '<article class="ss-support-message ' +
        (m.author_id === accountId ? 'is-mine' : 'is-support') +
        '"><strong>' +
        e(m.author_id === accountId ? "You" : m.name || "Support") +
        '</strong><p>' + e(m.body) +
        '</p><small>' + e(date(m.created_at)) + '</small></article>'
      ).join("") + (ticket.status === "resolved"
        ? '<p class="ss-support-empty">Resolved. Choose New conversation if you need more help.</p>'
        : "");

      if (previous !== html) {
        thread.innerHTML = html;
        thread.scrollTop = nearBottom ? thread.scrollHeight : previousScroll;
      }

      subjectLabel.hidden = true;
      subject.required = false;
      formElement.hidden = ticket.status === "resolved";
    } catch (error) {
      if (alive()) errorBox.textContent = error.message;
    } finally {
      busy = false;
    }
  }

  select.addEventListener("change", async () => {
    selected = select.value ? Number(select.value) : null;
    errorBox.textContent = "";
    await reload();
  });

  root.querySelector("#ss-support-refresh").addEventListener("click", reload);

  formElement.addEventListener("submit", async event => {
    event.preventDefault();
    const button = formElement.querySelector('button[type="submit"]');
    if (button.disabled || busy) return;

    button.disabled = true;
    errorBox.textContent = "";

    try {
      const body = formElement.elements.body.value.trim();
      if (body.length < 10) throw new Error("Please write at least 10 characters.");

      if (selected) {
        await api("/support/tickets/" + selected + "/replies", "POST", { body });
      } else {
        const result = await api("/support/tickets", "POST", {
          subject: subject.value.trim(),
          body
        });
        selected = result.ticket.id;
      }

      if (!alive()) return;
      formElement.elements.body.value = "";
      await reload();
      thread.scrollTop = thread.scrollHeight;
      notice("Message sent.");
    } catch (error) {
      if (alive()) errorBox.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const timer = setInterval(() => {
    if (!alive()) {
      clearInterval(timer);
      return;
    }
    if (!document.hidden) void reload();
  }, 10000);

  void reload();
}

// Mount after Help is rendered; leave typed messages intact while polling.
const supportMountObserver = new MutationObserver(mountHelpChat);
const supportApp = document.getElementById("app");
if (supportApp) supportMountObserver.observe(supportApp, { childList: true });
setInterval(mountHelpChat, 2000);
mountHelpChat();


// Service page back navigation
function addServiceBackButton() {
  const app = document.getElementById("app");
  if (!app || app.querySelector(".ss-service-back")) return;

  const route = location.hash.slice(1).split("?")[0];
  const destinations = {
    "explore": ["home?section=skills", "Back to skills"],
    "dashboard/new": ["home?section=skills", "Back to skills"],
    "dashboard/matches": ["home?section=skills", "Back to skills"],
    "dashboard/preferences": ["dashboard/matches", "Back to exchanges"]
  };

  const destination = destinations[route];
  if (!destination) return;

  const link = document.createElement("a");
  link.className = "ss-service-back";
  link.href = "#" + destination[0];
  link.textContent = "\u2190 " + destination[1];
  app.prepend(link);
}

const serviceBackApp = document.getElementById("app");
if (serviceBackApp) {
  new MutationObserver(addServiceBackButton).observe(
    serviceBackApp, { childList: true }
  );
}

window.addEventListener("hashchange", addServiceBackButton);
addServiceBackButton();
