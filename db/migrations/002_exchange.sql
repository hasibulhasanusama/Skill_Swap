CREATE TABLE IF NOT EXISTS skill_preferences (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), skill TEXT NOT NULL CHECK(length(skill) BETWEEN 2 AND 80),
 kind TEXT NOT NULL CHECK(kind IN ('teach','learn')), level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 3),
 UNIQUE(user_id,skill,kind)
);
CREATE TABLE IF NOT EXISTS exchange_availability (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439), end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440),
 CHECK(end_minute>start_minute), UNIQUE(user_id,weekday,start_minute,end_minute)
);
CREATE TABLE IF NOT EXISTS exchanges (
 id SERIAL PRIMARY KEY, requester_id INTEGER NOT NULL REFERENCES users(id), recipient_id INTEGER NOT NULL REFERENCES users(id),
 requester_skill TEXT NOT NULL, recipient_skill TEXT NOT NULL, message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','negotiating','active','completed','rejected','cancelled')),
 requester_objective TEXT NOT NULL DEFAULT '', recipient_objective TEXT NOT NULL DEFAULT '',
 requester_accepted BOOLEAN NOT NULL DEFAULT FALSE, recipient_accepted BOOLEAN NOT NULL DEFAULT FALSE,
 revision INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(requester_id<>recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_exchange_pair ON exchanges(LEAST(requester_id,recipient_id),GREATEST(requester_id,recipient_id)) WHERE status IN ('pending','negotiating','active');
CREATE TABLE IF NOT EXISTS exchange_sessions (
 id SERIAL PRIMARY KEY, exchange_id INTEGER NOT NULL REFERENCES exchanges(id), teacher_id INTEGER NOT NULL REFERENCES users(id),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, teacher_completed BOOLEAN NOT NULL DEFAULT FALSE,
 learner_confirmed BOOLEAN NOT NULL DEFAULT FALSE, CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS exchange_session_schedule ON exchange_sessions(exchange_id,starts_at);
CREATE TABLE IF NOT EXISTS exchange_reports (
 id SERIAL PRIMARY KEY, exchange_id INTEGER NOT NULL REFERENCES exchanges(id), reporter_id INTEGER NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 resolution TEXT, resolved_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_exchange_report ON exchange_reports(exchange_id,reporter_id) WHERE status='open';
