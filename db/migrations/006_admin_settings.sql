CREATE TABLE IF NOT EXISTS admin_roles (key TEXT PRIMARY KEY,label TEXT NOT NULL,permissions TEXT[] NOT NULL);
INSERT INTO admin_roles(key,label,permissions) VALUES
 ('superadmin','Super administrator',ARRAY['*']),
 ('verifier','Student verification',ARRAY['overview.read','verification.read','verification.write','files.verification','audit.read']),
 ('support','Student support',ARRAY['overview.read','users.read','support.read','support.write','bookings.read','exchanges.read','exchanges.write','reports.read']),
 ('finance','Sandbox finance',ARRAY['overview.read','payments.read','payments.write','disputes.read','disputes.write','files.dispute','reports.read','audit.read']),
 ('moderator','Content moderation',ARRAY['overview.read','listings.read','listings.write','categories.read','categories.write','reviews.read','reviews.write','portfolios.read','portfolios.write','files.content','announcements.read','announcements.write','audit.read'])
ON CONFLICT DO NOTHING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role TEXT REFERENCES admin_roles(key);
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_kind TEXT CHECK(suspension_kind IN ('administrative','deactivated'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{"activity":true,"session_reminders":true}';
UPDATE users SET admin_role='superadmin' WHERE role='admin' AND admin_role IS NULL;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK(moderation_status IN ('visible','hidden'));
ALTER TABLE listings ADD COLUMN IF NOT EXISTS moderation_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS moderated_by INTEGER REFERENCES users(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK(cancellation_notice_hours BETWEEN 0 AND 168);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completion_response_hours INTEGER NOT NULL DEFAULT 72 CHECK(completion_response_hours BETWEEN 1 AND 720);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_slot_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS one_reserved_booking_per_slot ON bookings(slot_id) WHERE status='reserved';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_bps INTEGER CHECK(commission_bps BETWEEN 0 AND 10000);
UPDATE payments p SET commission_bps=a.commission_bps FROM payment_allocations a WHERE a.payment_id=p.id AND p.commission_bps IS NULL;
CREATE TABLE IF NOT EXISTS platform_policies (
 id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 1,commission_bps INTEGER CHECK(commission_bps BETWEEN 0 AND 10000),
 completion_response_hours INTEGER CHECK(completion_response_hours BETWEEN 1 AND 720),cancellation_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK(cancellation_notice_hours BETWEEN 0 AND 168),
 registration_open BOOLEAN NOT NULL DEFAULT TRUE,listing_publication_open BOOLEAN NOT NULL DEFAULT TRUE,
 policy_text TEXT NOT NULL DEFAULT 'Students only. Verification confirms enrolment, not teaching ability. Sandbox transactions are simulated. Learners may cancel funded sessions before the stated notice cutoff; mentors may cancel upcoming sessions with a full simulated refund. Late paid cancellations require support or dispute review. No native video calling or real escrow is provided.',
 updated_by INTEGER REFERENCES users(id),updated_at TIMESTAMPTZ
);
INSERT INTO platform_policies(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS announcements (
 id SERIAL PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN ('public','students')),
 published BOOLEAN NOT NULL DEFAULT FALSE,created_by INTEGER NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_tickets (
 id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),subject TEXT NOT NULL,body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),assigned_to INTEGER REFERENCES users(id),
 resolution_reason TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_replies (
 id SERIAL PRIMARY KEY,ticket_id INTEGER NOT NULL REFERENCES support_tickets(id),author_id INTEGER NOT NULL REFERENCES users(id),
 body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS booking_cancellations (
 id SERIAL PRIMARY KEY,booking_id INTEGER UNIQUE NOT NULL REFERENCES bookings(id),actor_id INTEGER NOT NULL REFERENCES users(id),
 idempotency_key UUID NOT NULL,reason TEXT NOT NULL,refund_id INTEGER REFERENCES refunds(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(actor_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS exchange_cancellations (
 id SERIAL PRIMARY KEY,exchange_id INTEGER NOT NULL REFERENCES exchanges(id),proposer_id INTEGER NOT NULL REFERENCES users(id),reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled')),responder_id INTEGER REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),responded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_exchange_cancellation ON exchange_cancellations(exchange_id) WHERE status='pending';
