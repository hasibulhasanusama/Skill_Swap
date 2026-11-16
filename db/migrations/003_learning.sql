ALTER TABLE bookings ADD COLUMN IF NOT EXISTS learning_status TEXT NOT NULL DEFAULT 'scheduled' CHECK(learning_status IN ('scheduled','completion_pending','completed'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS meeting_url TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mentor_completed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS learner_confirmed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmation_due_at TIMESTAMPTZ;
ALTER TABLE exchange_sessions ADD COLUMN IF NOT EXISTS meeting_url TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS learning_messages (
 id SERIAL PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id), exchange_id INTEGER REFERENCES exchanges(id),
 sender_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 client_key UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(booking_id,exchange_id)=1), UNIQUE(sender_id,client_key)
);
CREATE INDEX IF NOT EXISTS message_booking_order ON learning_messages(booking_id,id);
CREATE INDEX IF NOT EXISTS message_exchange_order ON learning_messages(exchange_id,id);
CREATE TABLE IF NOT EXISTS message_reads (
 user_id INTEGER NOT NULL REFERENCES users(id), message_id INTEGER NOT NULL REFERENCES learning_messages(id),
 read_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,message_id)
);
CREATE TABLE IF NOT EXISTS learning_materials (
 id SERIAL PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id), exchange_id INTEGER REFERENCES exchanges(id),
 uploader_id INTEGER NOT NULL REFERENCES users(id), file_id INTEGER UNIQUE NOT NULL REFERENCES files(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 120), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(booking_id,exchange_id)=1)
);
CREATE TABLE IF NOT EXISTS reschedule_requests (
 id SERIAL PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id), exchange_session_id INTEGER REFERENCES exchange_sessions(id),
 proposer_id INTEGER NOT NULL REFERENCES users(id), original_starts_at TIMESTAMPTZ NOT NULL,
 proposed_starts_at TIMESTAMPTZ NOT NULL, proposed_ends_at TIMESTAMPTZ NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','cancelled','superseded')),
 responder_id INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), responded_at TIMESTAMPTZ,
 CHECK(num_nonnulls(booking_id,exchange_session_id)=1), CHECK(proposed_ends_at>proposed_starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_booking_reschedule ON reschedule_requests(booking_id) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_exchange_reschedule ON reschedule_requests(exchange_session_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS attendance_records (
 id SERIAL PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id), exchange_session_id INTEGER REFERENCES exchange_sessions(id),
 user_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('present','absent')),
 note TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(booking_id,exchange_session_id)=1), UNIQUE(booking_id,user_id), UNIQUE(exchange_session_id,user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, route TEXT NOT NULL,
 event_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), read_at TIMESTAMPTZ,
 UNIQUE(user_id,event_key)
);
