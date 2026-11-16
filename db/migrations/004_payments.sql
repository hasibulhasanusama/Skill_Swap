-- Existing reservations remain legacy/unpaid-by-policy; new paid reservations explicitly opt in.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_required BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS sandbox_charges (
 reference UUID PRIMARY KEY, event_id UUID UNIQUE NOT NULL, booking_id INTEGER NOT NULL REFERENCES bookings(id),
 payer_id INTEGER NOT NULL REFERENCES users(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 currency TEXT NOT NULL DEFAULT 'BDT' CHECK(currency='BDT'), status TEXT NOT NULL CHECK(status IN ('succeeded','failed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
 id SERIAL PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id), payer_id INTEGER NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL DEFAULT 'sandbox' CHECK(provider='sandbox'), provider_ref UUID UNIQUE NOT NULL REFERENCES sandbox_charges(reference),
 idempotency_key UUID NOT NULL, scenario TEXT NOT NULL CHECK(scenario IN ('success','failure')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL DEFAULT 'BDT' CHECK(currency='BDT'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(payer_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_successful_payment ON payments(booking_id) WHERE status='succeeded';
CREATE TABLE IF NOT EXISTS payment_events (
 event_id UUID PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id), processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_allocations (
 id SERIAL PRIMARY KEY, booking_id INTEGER UNIQUE NOT NULL REFERENCES bookings(id), payment_id INTEGER UNIQUE NOT NULL REFERENCES payments(id),
 mentor_id INTEGER NOT NULL REFERENCES users(id), gross_minor INTEGER NOT NULL CHECK(gross_minor>0),
 commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),
 refunded_minor INTEGER NOT NULL DEFAULT 0 CHECK(refunded_minor>=0 AND refunded_minor<=gross_minor),
 status TEXT NOT NULL DEFAULT 'held' CHECK(status IN ('held','released','refunded')), on_hold BOOLEAN NOT NULL DEFAULT FALSE,
 mentor_released_minor INTEGER NOT NULL DEFAULT 0 CHECK(mentor_released_minor>=0),
 commission_released_minor INTEGER NOT NULL DEFAULT 0 CHECK(commission_released_minor>=0),
 released_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(mentor_released_minor+commission_released_minor<=gross_minor-refunded_minor)
);
CREATE TABLE IF NOT EXISTS mentor_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES users(id), balance_minor INTEGER NOT NULL DEFAULT 0 CHECK(balance_minor>=0)
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id SERIAL PRIMARY KEY, mentor_id INTEGER NOT NULL REFERENCES users(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 idempotency_key UUID NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected','cancelled')),
 decision_reason TEXT, decided_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ,
 UNIQUE(mentor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS wallet_entries (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), delta_minor INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('release','refund','withdrawal_reserved','withdrawal_returned')),
 reference TEXT UNIQUE NOT NULL, allocation_id INTEGER REFERENCES payment_allocations(id), withdrawal_id INTEGER REFERENCES withdrawals(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_user_order ON wallet_entries(user_id,id);
CREATE TABLE IF NOT EXISTS platform_ledger (
 id SERIAL PRIMARY KEY, delta_minor INTEGER NOT NULL, reference TEXT UNIQUE NOT NULL,
 allocation_id INTEGER NOT NULL REFERENCES payment_allocations(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sandbox_refunds (
 reference UUID PRIMARY KEY, charge_ref UUID NOT NULL REFERENCES sandbox_charges(reference),
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), operation_key TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refunds (
 id SERIAL PRIMARY KEY, allocation_id INTEGER NOT NULL REFERENCES payment_allocations(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 provider_ref UUID UNIQUE NOT NULL REFERENCES sandbox_refunds(reference), operation_key TEXT UNIQUE NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id), reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sandbox_payouts (
 reference UUID PRIMARY KEY, withdrawal_id INTEGER NOT NULL REFERENCES withdrawals(id), operation_key UUID UNIQUE NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>0), status TEXT NOT NULL CHECK(status IN ('succeeded','failed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_successful_payout ON sandbox_payouts(withdrawal_id) WHERE status='succeeded';
CREATE TABLE IF NOT EXISTS payment_disputes (
 id SERIAL PRIMARY KEY, allocation_id INTEGER NOT NULL REFERENCES payment_allocations(id), booking_id INTEGER NOT NULL REFERENCES bookings(id),
 opened_by INTEGER NOT NULL REFERENCES users(id), category TEXT NOT NULL CHECK(category IN ('absence','suspected_fraud','inappropriate_behaviour','unfulfilled_agreement')),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','under_review','resolved')),
 assigned_to INTEGER REFERENCES users(id), outcome TEXT CHECK(outcome IN ('refund','release')), resolution_reason TEXT,
 resolved_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_payment_dispute ON payment_disputes(allocation_id) WHERE status IN ('open','under_review');
CREATE TABLE IF NOT EXISTS dispute_statements (
 id SERIAL PRIMARY KEY, dispute_id INTEGER NOT NULL REFERENCES payment_disputes(id), user_id INTEGER NOT NULL REFERENCES users(id),
 body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dispute_evidence (
 id SERIAL PRIMARY KEY, dispute_id INTEGER NOT NULL REFERENCES payment_disputes(id), uploader_id INTEGER NOT NULL REFERENCES users(id),
 file_id INTEGER UNIQUE NOT NULL REFERENCES files(id), title TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sandbox_demo_fixtures (
 marker TEXT PRIMARY KEY, booking_id INTEGER UNIQUE NOT NULL REFERENCES bookings(id)
);
