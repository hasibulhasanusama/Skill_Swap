
CREATE TABLE learning_session_clocks (
 kind TEXT NOT NULL CHECK(kind IN ('booking','exchange-session')),
 session_id INTEGER NOT NULL,
 teacher_id INTEGER NOT NULL REFERENCES users(id),
 learner_id INTEGER NOT NULL REFERENCES users(id),
 duration_seconds INTEGER NOT NULL CHECK(duration_seconds>0),
 route TEXT NOT NULL,
 teacher_joined_at TIMESTAMPTZ,
 learner_joined_at TIMESTAMPTZ,
 teacher_ready_at TIMESTAMPTZ,
 learner_ready_at TIMESTAMPTZ,
 started_at TIMESTAMPTZ,
 ends_at TIMESTAMPTZ,
 notified_at TIMESTAMPTZ,
 PRIMARY KEY(kind,session_id),
 CHECK(teacher_id<>learner_id)
);
CREATE INDEX learning_clocks_due
 ON learning_session_clocks(ends_at)
 WHERE notified_at IS NULL;
