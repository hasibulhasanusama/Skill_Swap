export function createPaymentUI({
  api,
  e,
  form,
  bind,
  notice,
  date,
  money,
  user,
  shell,
}) {
  const can = (p) =>
    user()?.permissions?.includes("*") || user()?.permissions?.includes(p);
  const keys = new Map();
  let currentCheckout = null;
  const banner =
    '<div class="note sandbox-banner"><strong>SANDBOX ONLY · BDT</strong><br>All charges, allocations, refunds and withdrawals are simulated. No real money, real escrow, card details or bank transfers.</div>';
  const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
  const amountInput = (name, label, max) =>
    /* HTML */ `<label
      >${label}<input
        name="${name}"
        type="number"
        step="0.01"
        min="0.01"
        ${max !== undefined ? `max="${max / 100}"` : ""}
        required
    /></label>`;
  const why =
    '<label>Decision reason<textarea name="reason" minlength="10" maxlength="3000" required></textarea></label>';
  const minor = (value) => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))
      throw Error("Use a positive BDT amount with up to two decimal places.");
    const [whole, fraction = ""] = value.split(".");
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw Error("Enter a valid positive amount.");
    return amount;
  };
  async function idempotent(operation, url, body) {
    const identity = operation + ":" + JSON.stringify(body);
    const idempotency_key = keys.get(identity) || crypto.randomUUID();
    keys.set(identity, idempotency_key);
    const result = await api(url, "POST", { ...body, idempotency_key });
    keys.delete(identity);
    return result;
  }
  const status = (a) => `${e(a.status)}${a.on_hold ? " · dispute hold" : ""}`;
  function allocationsHTML(allocations) {
    return (
      allocations
        .map(
          (a) =>
            /* HTML */ `<div class="row">
              <div>
                <strong
                  >Booking #${a.booking_id} ·
                  ${e(a.title || "Session allocation")}</strong
                >
                <p>
                  ${money(a.gross_minor)} paid · ${money(a.refunded_minor)}
                  refunded
                </p>
                <small
                  >${(a.commission_bps / 100).toFixed(2)}% platform commission
                  on the remaining amount · ${status(a)}</small
                >
              </div>
              <a
                class="button secondary small"
                href="#dashboard/room/booking/${a.booking_id}"
                >Learning room</a
              >
            </div>`,
        )
        .join("") || "<p>No verified session allocations yet.</p>"
    );
  }
  async function overview() {
    const d = await api("/payments/summary");
    return shell(
      "dashboard/payments",
      /* HTML */ `<div class="section-heading">
          <div>
            <div class="eyebrow">YOUR SESSION TRANSACTIONS</div>
            <h1>Payments & earnings</h1>
          </div>
          <button class="secondary small finance-refresh">Refresh</button>
        </div>
        ${banner}
        <div class="stats">
          <div class="panel stat">
            AVAILABLE SIMULATED
            EARNINGS<strong>${money(d.available_minor)}</strong>After refunds
            and reserved withdrawals
          </div>
          <div class="panel stat">
            HELD / DISPUTED
            EARNINGS<strong>${money(d.totals.held_earnings_minor)}</strong>Projected
            mentor share; not withdrawable
          </div>
          <div class="panel stat">
            SANDBOX PAYMENTS /
            REFUNDS<strong>${money(d.totals.paid_minor)}</strong>${money(d.totals.refunded_minor)}
            refunded to you
          </div>
        </div>
        <h2>Session allocations</h2>
        <div class="panel">${allocationsHTML(d.allocations)}</div>
        <div class="two spaced">
          <div class="panel">
            <h2>Request a sandbox withdrawal</h2>
            <p>
              Pending requests reserve simulated available balance immediately.
              No bank account details are needed.
            </p>
            ${d.available_minor > 0 ? form("withdraw", amountInput("amount", "Amount (BDT)", d.available_minor), "Request simulated withdrawal") : "<p>No available earnings yet. A verified allocation must be released after learner confirmation or a reasoned dispute decision.</p>"}
            <p>
              Pending: ${money(d.totals.withdrawal_pending_minor)} · Simulated
              payouts: ${money(d.totals.withdrawn_minor)}
            </p>
          </div>
          <div class="panel">
            <h2>Withdrawal history</h2>
            ${
              d.withdrawals
                .map(
                  (w) =>
                    /* HTML */ `<div class="row">
                      <div>
                        <strong>#${w.id} · ${money(w.amount_minor)}</strong>
                        <p>${e(w.status)} · ${date(w.created_at)}</p>
                        ${w.decision_reason ? `<small>${e(w.decision_reason)}</small>` : ""}
                      </div>
                      ${w.status === "pending" ? `<button class="small secondary cancel-withdrawal" data-id="${w.id}">Cancel request</button>` : ""}
                    </div>`,
                )
                .join("") || "<p>No withdrawal requests.</p>"
            }
          </div>
        </div>
        <h2 class="spaced">Payment attempts</h2>
        <div class="panel">
          ${
            d.payments
              .map(
                (p) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong>Booking #${p.booking_id} · ${e(p.title)}</strong>
                      <p>
                        ${money(p.amount_minor)} · ${e(p.status)} ·
                        ${date(p.created_at)}
                      </p>
                      <small>Sandbox reference: ${e(p.provider_ref)}</small>
                    </div>
                    <a href="#checkout/${p.booking_id}"
                      >View receipt / checkout →</a
                    >
                  </div>`,
              )
              .join("") || "<p>No sandbox payment attempts yet.</p>"
          }
        </div>
        <h2 class="spaced">Refund history</h2>
        <div class="panel">
          ${
            d.refunds
              .map(
                (r) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong
                        >Refund #${r.id} · ${money(r.amount_minor)}</strong
                      >
                      <p>${e(r.reason)}</p>
                      <small>${date(r.created_at)} · simulated</small>
                    </div>
                  </div>`,
              )
              .join("") || "<p>No refunds recorded.</p>"
          }
        </div>
        <h2 class="spaced">Mentor earnings ledger</h2>
        <div class="panel">
          ${
            d.ledger
              .map(
                (l) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong>${e(l.kind.replaceAll("_", " "))}</strong>
                      <p>${date(l.created_at)} · ${e(l.reference)}</p>
                    </div>
                    <strong
                      >${l.delta_minor >= 0 ? "+" : ""}${money(l.delta_minor)}</strong
                    >
                  </div>`,
              )
              .join("") || "<p>No earnings ledger entries yet.</p>"
          }
        </div>`,
    );
  }
  async function checkout(id) {
    const d = await api("/payments/checkout/" + id);
    currentCheckout = id;
    return /* HTML */ `<div class="intro">
      <a href="#dashboard/learning">← My learning</a>
      <div class="eyebrow spaced">SANDBOX CHECKOUT / BOOKING #${id}</div>
      <h1>Reserve your learning budget.</h1>
      ${banner}
      <div class="panel">
        <h2>Session fee breakdown</h2>
        <div class="row">
          <span>Session price</span
          ><strong>${money(d.pricing.gross_minor)}</strong>
        </div>
        <div class="row">
          <span>Platform commission (included)</span
          ><strong>${money(d.pricing.commission_minor)}</strong>
        </div>
        <div class="row">
          <span>Student Mentor share</span
          ><strong>${money(d.pricing.mentor_minor)}</strong>
        </div>
        <p>
          All prices and statuses are verified on the server. No additional
          checkout fee.
        </p>
        <p>${e(d.policy)}</p>
        ${d.allocation ? /* HTML */ `<div class="note">Payment verified · allocation ${status(d.allocation)}.<br />Refunded ${money(d.allocation.refunded_minor)}. ${d.allocation.on_hold ? "Administrator dispute review is required before release." : ""}</div>` : !d.booking.payment_required ? '<div class="note">This is a free or legacy reservation. No checkout is required.</div>' : d.enabled && d.booking.status === "reserved" && d.booking.learning_status === "scheduled" && Date.parse(d.booking.starts_at) > Date.now() ? form("sandbox-checkout", '<label>Sandbox scenario<select name="scenario"><option value="success">Simulate successful payment</option><option value="failure">Simulate failed payment</option></select></label><p>No card or banking information is requested.</p>', "Run sandbox payment") : "<p>Checkout is unavailable for this booking or sandbox transactions are disabled.</p>"}
        <div class="actions spaced">
          <a class="button secondary" href="#dashboard/room/booking/${id}"
            >Open learning room</a
          ><a href="#dashboard/payments">Payments & earnings →</a>
        </div>
      </div>
    </div>`;
  }
  async function disputes() {
    const [d, p] = await Promise.all([
      api("/payment-disputes"),
      api("/payments/summary"),
    ]);
    const eligible = p.allocations.filter(
      (a) => a.status === "held" && !a.on_hold,
    );
    return shell(
      "dashboard/disputes",
      /* HTML */ `<div class="eyebrow">SESSION PAYMENT PROTECTION</div>
        <h1>Payment complaints</h1>
        ${banner}
        <p>
          Open a complaint before an allocation is released. Absence complaints
          are available after the scheduled session ends. Both participants can
          add statements and private evidence.
        </p>
        <div class="panel">
          ${
            eligible.length
              ? form(
                  "open-payment-dispute",
                  /* HTML */ `<label
                      >Paid session<select name="booking_id">
                        ${eligible.map((a) => `<option value="${a.booking_id}">Booking #${a.booking_id} · ${e(a.title)} · ${money(a.gross_minor - a.refunded_minor)}</option>`).join("")}
                      </select></label
                    ><label
                      >Category<select name="category">
                        <option value="absence">
                          Mentor or learner absence
                        </option>
                        <option value="suspected_fraud">Suspected fraud</option>
                        <option value="inappropriate_behaviour">
                          Inappropriate behaviour
                        </option>
                        <option value="unfulfilled_agreement">
                          Unfulfilled agreement
                        </option>
                      </select></label
                    ><label
                      >Explain the issue<textarea
                        name="reason"
                        minlength="10"
                        maxlength="3000"
                        required
                      ></textarea>
                    </label>`,
                  "Open dispute & hold allocation",
                )
              : "<p>No unreleased, undisputed paid allocation is currently eligible for a complaint.</p>"
          }
        </div>
        <h2 class="spaced">Your disputes</h2>
        ${
          d.items
            .map(
              (x) =>
                /* HTML */ `<div class="panel exchange-card">
                  <div class="row">
                    <div>
                      <h3>Dispute #${x.id} · ${e(x.title)}</h3>
                      <p>
                        ${e(x.category.replaceAll("_", " "))} · ${e(x.status)}
                      </p>
                      <p>${e(x.reason)}</p>
                    </div>
                    <a
                      class="button secondary small"
                      href="#dashboard/dispute/${x.id}"
                      >Open complaint</a
                    >
                  </div>
                </div>`,
            )
            .join("") ||
          '<div class="panel empty">No payment complaints submitted.</div>'
        }`,
    );
  }
  async function disputeDetail(id, asAdmin = false) {
    const d = await api("/payment-disputes/" + id);
    const x = d.dispute;
    const admins = asAdmin
      ? (await api("/admin/payment-disputes")).administrators
      : [];
    const participants = [d.booking.learner_id, d.booking.mentor_id].includes(
      user().id,
    );
    return shell(
      asAdmin ? "admin/disputes" : "dashboard/disputes",
      /* HTML */ `<a
          href="#${asAdmin ? "admin/disputes" : "dashboard/disputes"}"
          >← Dispute list</a
        >
        <div class="eyebrow spaced">SANDBOX REVIEW / DISPUTE #${id}</div>
        <h1>${e(x.category.replaceAll("_", " "))}</h1>
        ${banner}
        <div class="panel">
          <span class="pill">${e(x.status)}</span>
          <p class="spaced">${e(x.reason)}</p>
          <p>
            Booking #${d.booking.id} · learner #${d.booking.learner_id} · mentor
            #${d.booking.mentor_id}
          </p>
          <p>
            Gross ${money(d.allocation.gross_minor)} · refunded
            ${money(d.allocation.refunded_minor)} · ${status(d.allocation)}
          </p>
          <p>
            Delivery: ${e(d.booking.learning_status)} · learner confirmed:
            ${d.booking.learner_confirmed_at ? "yes" : "no"}
          </p>
          ${
            x.status === "resolved"
              ? /* HTML */ `<div class="note">
                  <strong>Decision: ${e(x.outcome)}</strong>
                  <p>${e(x.resolution_reason)}</p>
                  <p>${date(x.resolved_at)}</p>
                </div>`
              : ""
          }
        </div>
        <div class="two spaced">
          <section class="panel">
            <h2>Participant statements</h2>
            ${
              d.statements
                .map(
                  (s) =>
                    /* HTML */ `<div class="message">
                      <strong>${e(s.name)}</strong>
                      <p>${e(s.body)}</p>
                      <small>${date(s.created_at)}</small>
                    </div>`,
                )
                .join("") || "<p>No additional statements yet.</p>"
            }${participants && x.status !== "resolved" ? form("dispute-statement", /* HTML */ `<input type="hidden" name="id" value="${id}" /><label>Your statement<textarea name="body" minlength="5" maxlength="4000" required></textarea></label>`, "Submit statement") : ""}
          </section>
          <section class="panel">
            <h2>Private evidence</h2>
            ${
              d.evidence
                .map(
                  (f) =>
                    /* HTML */ `<div class="row">
                      <div>
                        <strong>${e(f.title)}</strong>
                        <p>${e(f.name)}</p>
                      </div>
                      ${!asAdmin || can("files.dispute") ? /* HTML */ `<a href="/api/files/${f.file_id}">Download ${e(f.original_name)}</a>` : "File access restricted by administrator role."}
                    </div>`,
                )
                .join("") || "<p>No evidence uploaded.</p>"
            }${participants && x.status !== "resolved" ? form("dispute-evidence", /* HTML */ `<input type="hidden" name="id" value="${id}" /><label>Evidence title<input name="title" minlength="2" maxlength="120" required /></label><label>Evidence (PDF, image, TXT/MD; max 5 MB)<input type="file" name="evidence" accept=".pdf,.png,.jpg,.jpeg,.txt,.md" required /></label>`, "Upload private evidence") : ""}
          </section>
        </div>
        ${
          asAdmin && can("disputes.write") && x.status !== "resolved"
            ? /* HTML */ `<div class="two spaced">
                <section class="panel">
                  <h2>Assign review</h2>
                  ${form(
                    "assign-payment-dispute",
                    /* HTML */ `<input
                        type="hidden"
                        name="id"
                        value="${id}"
                      /><label
                        >Administrator<select name="admin_id">
                          ${admins.map((a) => `<option value="${a.id}" ${x.assigned_to === a.id ? "selected" : ""}>${e(a.name)}</option>`).join("")}
                        </select></label
                      >${why}`,
                    "Record assignment",
                  )}
                </section>
                <section class="panel">
                  <h2>Reasoned resolution</h2>
                  <p>
                    A partial refund releases the remainder to the mentor. A
                    full refund cancels the reservation. This does not claim the
                    session was delivered.
                  </p>
                  ${form(
                    "resolve-payment-dispute",
                    /* HTML */ `<input
                        type="hidden"
                        name="id"
                        value="${id}"
                      /><label
                        >Outcome<select name="outcome" id="resolution-outcome">
                          <option value="refund">
                            Refund full or partial; release remainder
                          </option>
                          <option value="release">
                            Release remaining allocation to mentor
                          </option>
                        </select></label
                      >${amountInput("refund_bdt", "Refund amount (BDT)", d.allocation.gross_minor - d.allocation.refunded_minor)}${why}`,
                    "Resolve sandbox dispute",
                  )}
                </section>
              </div>`
            : ""
        }`,
    );
  }
  async function adminPayments() {
    const d = await api("/admin/payments");
    return shell(
      "admin/payments",
      /* HTML */ `<div class="section-heading">
          <h1>Payment administration</h1>
          <button class="secondary small finance-refresh">Refresh</button>
        </div>
        ${banner}
        <div class="stats">
          <div class="panel stat">
            SIMULATED COMMISSION (ALL
            RECORDS)<strong>${money(d.commission_minor)}</strong>Net of
            reversals
          </div>
          <div class="panel stat">
            AVAILABLE MENTOR
            BALANCES<strong>${money(d.accounts.reduce((n, a) => n + a.balance_minor, 0))}</strong>After
            pending withdrawal reservations
          </div>
        </div>
        <h2>Session allocations</h2>
        ${
          d.allocations
            .map(
              (a) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>
                    Allocation #${a.id} · Booking #${a.booking_id}
                    <span class="pill">${status(a)}</span>
                  </h3>
                  <p>
                    Gross ${money(a.gross_minor)} · refunded
                    ${money(a.refunded_minor)} · released to mentor
                    ${money(a.mentor_released_minor)}
                  </p>
                  <p>
                    Platform commission ${money(a.commission_released_minor)} ·
                    ${(a.commission_bps / 100).toFixed(2)}%
                  </p>
                  ${can("payments.write") && a.status !== "refunded" && !a.on_hold ? `<details><summary>Issue a full or partial simulated refund</summary>${form("admin-refund-" + a.id, amountInput("amount", "Refund amount (BDT)", a.gross_minor - a.refunded_minor) + why, "Record sandbox refund")}</details>${a.status === "held" && a.learning_status === "completed" ? form("admin-release-" + a.id, why, "Release learner-confirmed allocation") : ""}` : a.on_hold ? "<p>Open dispute hold: use the dispute resolution workflow.</p>" : ""}
                </section>`,
            )
            .join("") || '<div class="panel empty">No allocations yet.</div>'
        }
        <h2 class="spaced">Withdrawal requests</h2>
        ${
          d.withdrawals
            .map(
              (w) =>
                /* HTML */ `<section class="panel exchange-card">
                  <h3>
                    ${e(w.name)} · ${money(w.amount_minor)}
                    <span class="pill">${e(w.status)}</span>
                  </h3>
                  ${w.decision_reason ? /* HTML */ `<p>${e(w.decision_reason)}</p>` : ""}${can("payments.write") && w.status === "pending" ? form("admin-withdrawal-" + w.id, '<label>Action<select name="action"><option value="pay">Simulate payout</option><option value="reject">Reject and restore balance</option></select></label><label>Sandbox payout scenario<select name="scenario"><option value="success">Successful simulated payout</option><option value="failure">Failed simulated payout; keep pending</option></select></label>' + why, "Record withdrawal decision") : ""}
                </section>`,
            )
            .join("") || "<p>No withdrawal requests.</p>"
        }
        <h2 class="spaced">Transactions (latest 200)</h2>
        <div class="panel">
          ${
            d.payments
              .map(
                (p) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong
                        >#${p.id} · ${e(p.payer_name)} ·
                        ${money(p.amount_minor)}</strong
                      >
                      <p>${e(p.title)} · ${e(p.status)}</p>
                      <small
                        >${date(p.created_at)} · ${e(p.provider_ref)}</small
                      >
                    </div>
                  </div>`,
              )
              .join("") || "<p>No payments.</p>"
          }
        </div>
        <h2 class="spaced">Refunds (latest 200)</h2>
        <div class="panel">
          ${
            d.refunds
              .map(
                (r) =>
                  /* HTML */ `<div class="row">
                    <div>
                      <strong>#${r.id} · ${money(r.amount_minor)}</strong>
                      <p>${e(r.reason)}</p>
                    </div>
                  </div>`,
              )
              .join("") || "<p>No refunds.</p>"
          }
        </div>`,
      true,
    );
  }
  async function adminDisputes() {
    const d = await api("/admin/payment-disputes");
    return shell(
      "admin/disputes",
      /* HTML */ `<div class="eyebrow">PAYMENT PROTECTION REVIEW</div>
        <h1>Dispute queue</h1>
        ${banner}${
          d.items
            .map(
              (x) =>
                /* HTML */ `<div class="panel exchange-card">
                  <div class="row">
                    <div>
                      <h3>#${x.id} · ${e(x.title)}</h3>
                      <p>
                        ${e(x.opened_by_name)} ·
                        ${e(x.category.replaceAll("_", " "))} · ${e(x.status)}
                      </p>
                      <p>${e(x.reason)}</p>
                    </div>
                    <a
                      class="button secondary small"
                      href="#admin/dispute/${x.id}"
                      >Inspect & resolve</a
                    >
                  </div>
                </div>`,
            )
            .join("") || '<div class="panel empty">No payment disputes.</div>'
        }`,
      true,
    );
  }
  async function render(route) {
    if (route.startsWith("checkout/"))
      return checkout(Number(route.split("/")[1]));
    if (route === "dashboard/payments") return overview();
    if (route === "dashboard/disputes") return disputes();
    if (route.startsWith("dashboard/dispute/"))
      return disputeDetail(Number(route.split("/")[2]));
    if (route === "admin/payments") return adminPayments();
    if (route === "admin/disputes") return adminDisputes();
    return disputeDetail(Number(route.split("/")[2]), true);
  }
  function wire() {
    document
      .querySelectorAll(".finance-refresh")
      .forEach((b) => b.addEventListener("click", refresh));
    bind("sandbox-checkout", async (b) => {
      const r = await idempotent(
        "checkout:" + currentCheckout,
        `/bookings/${currentCheckout}/checkout`,
        { scenario: b.scenario },
      );
      notice(r.message);
      refresh();
    });
    bind("withdraw", async (b) => {
      notice(
        (
          await idempotent("withdraw", "/withdrawals", {
            amount_minor: minor(b.amount),
          })
        ).message,
      );
      refresh();
    });
    document
      .querySelectorAll(".cancel-withdrawal")
      .forEach((b) =>
        b.addEventListener("click", () =>
          buttonRun(b, () =>
            api(`/withdrawals/${b.dataset.id}/cancel`, "POST", {}),
          ),
        ),
      );
    bind("open-payment-dispute", async (b) => {
      const r = await api("/payment-disputes", "POST", {
        ...b,
        booking_id: Number(b.booking_id),
      });
      notice(r.message);
      location.hash = "dashboard/dispute/" + r.dispute.id;
    });
    bind("dispute-statement", async (b) => {
      notice(
        (
          await api(`/payment-disputes/${b.id}/statements`, "POST", {
            body: b.body,
          })
        ).message,
      );
      refresh();
    });
    bind("dispute-evidence", async (b, f) => {
      notice(
        (
          await api(
            `/payment-disputes/${b.id}/evidence`,
            "POST",
            new FormData(f),
          )
        ).message,
      );
      refresh();
    });
    bind("assign-payment-dispute", async (b) => {
      notice(
        (
          await api(`/admin/payment-disputes/${b.id}/assign`, "POST", {
            admin_id: Number(b.admin_id),
            reason: b.reason,
          })
        ).message,
      );
      refresh();
    });
    bind("resolve-payment-dispute", async (b) => {
      const body = { outcome: b.outcome, reason: b.reason };
      if (b.outcome === "refund") body.refund_minor = minor(b.refund_bdt);
      notice(
        (await api(`/admin/payment-disputes/${b.id}/resolve`, "POST", body))
          .message,
      );
      refresh();
    });
    const outcome = document.querySelector("#resolution-outcome");
    if (outcome)
      outcome.addEventListener("change", () => {
        const input = document.querySelector("[name=refund_bdt]");
        input.disabled = outcome.value !== "refund";
        input.required = outcome.value === "refund";
      });
    document.querySelectorAll('[id^="admin-refund-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await idempotent(
              f.id,
              `/admin/allocations/${f.id.split("-").pop()}/refunds`,
              { amount_minor: minor(b.amount), reason: b.reason },
            )
          ).message,
        );
        refresh();
      }),
    );
    document.querySelectorAll('[id^="admin-release-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await api(
              `/admin/allocations/${f.id.split("-").pop()}/release`,
              "POST",
              { reason: b.reason },
            )
          ).message,
        );
        refresh();
      }),
    );
    document.querySelectorAll('[id^="admin-withdrawal-"]').forEach((f) =>
      bind(f.id, async (b) => {
        notice(
          (
            await idempotent(
              f.id,
              `/admin/withdrawals/${f.id.split("-").pop()}/decide`,
              b,
            )
          ).message,
        );
        refresh();
      }),
    );
  }
  function buttonRun(b, run) {
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
