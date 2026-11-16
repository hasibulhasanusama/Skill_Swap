CREATE TABLE IF NOT EXISTS users (
 id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 name TEXT NOT NULL, institution TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','admin')),
 verification TEXT NOT NULL DEFAULT 'unverified' CHECK(verification IN ('unverified','pending','approved','rejected')),
 suspended BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS session (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session(expire);
CREATE TABLE IF NOT EXISTS password_resets (
 id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), token_hash TEXT UNIQUE NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS files (
 id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), storage_key TEXT UNIQUE NOT NULL,
 original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verifications (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), file_id INTEGER NOT NULL REFERENCES files(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reason TEXT, reviewer_id INTEGER REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now(), reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_verification ON verifications(user_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS listings (
 id SERIAL PRIMARY KEY, mentor_id INTEGER NOT NULL REFERENCES users(id), category_id INTEGER NOT NULL REFERENCES categories(id),
 title TEXT NOT NULL, description TEXT NOT NULL, level TEXT NOT NULL CHECK(level IN ('Beginner','Intermediate','Advanced')),
 objectives TEXT NOT NULL, prerequisites TEXT NOT NULL DEFAULT '', duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 15 AND 180),
 fee_minor INTEGER NOT NULL CHECK(fee_minor>=0), exchange_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','inactive')),
 created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_filter_idx ON listings(status,category_id,level,fee_minor);
CREATE TABLE IF NOT EXISTS availability (
 id SERIAL PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES listings(id),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, CHECK(ends_at>starts_at), UNIQUE(listing_id,starts_at)
);
CREATE TABLE IF NOT EXISTS bookings (
 id SERIAL PRIMARY KEY, learner_id INTEGER NOT NULL REFERENCES users(id), mentor_id INTEGER NOT NULL REFERENCES users(id),
 listing_id INTEGER NOT NULL REFERENCES listings(id), slot_id INTEGER UNIQUE NOT NULL REFERENCES availability(id),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(amount_minor>=0),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','cancelled')),
 created_at TIMESTAMPTZ DEFAULT now(), CHECK(learner_id<>mentor_id)
);
CREATE INDEX IF NOT EXISTS booking_participants_idx ON bookings(learner_id,mentor_id,starts_at);
CREATE TABLE IF NOT EXISTS saved_skills (user_id INTEGER REFERENCES users(id), listing_id INTEGER REFERENCES listings(id), PRIMARY KEY(user_id,listing_id));
CREATE TABLE IF NOT EXISTS audit_logs (
 id SERIAL PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
 target TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
);
