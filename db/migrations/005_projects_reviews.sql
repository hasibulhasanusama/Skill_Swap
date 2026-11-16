CREATE TABLE IF NOT EXISTS project_tasks (
 id SERIAL PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id), exchange_id INTEGER REFERENCES exchanges(id),
 mentor_id INTEGER NOT NULL REFERENCES users(id), learner_id INTEGER NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('exercise','project')), title TEXT NOT NULL, instructions TEXT NOT NULL,
 due_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(booking_id,exchange_id)=1), CHECK(mentor_id<>learner_id)
);
CREATE INDEX IF NOT EXISTS project_task_participants ON project_tasks(learner_id,mentor_id,id);
CREATE TABLE IF NOT EXISTS project_submissions (
 id SERIAL PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES project_tasks(id), student_id INTEGER NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL CHECK(version>0), summary TEXT NOT NULL, external_url TEXT NOT NULL DEFAULT '', file_id INTEGER REFERENCES files(id),
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','changes_requested','approved')),
 client_key UUID NOT NULL, content_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(task_id,version), UNIQUE(student_id,client_key)
);
CREATE TABLE IF NOT EXISTS project_feedback (
 id SERIAL PRIMARY KEY, submission_id INTEGER UNIQUE NOT NULL REFERENCES project_submissions(id), mentor_id INTEGER NOT NULL REFERENCES users(id),
 verdict TEXT NOT NULL CHECK(verdict IN ('changes_requested','approved')), comment TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS portfolio_entries (
 id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), submission_id INTEGER UNIQUE REFERENCES project_submissions(id),
 title TEXT NOT NULL, description TEXT NOT NULL, external_url TEXT NOT NULL DEFAULT '', file_id INTEGER REFERENCES files(id),
 share_file BOOLEAN NOT NULL DEFAULT FALSE, visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
 moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK(moderation_status IN ('visible','hidden')),
 moderation_reason TEXT NOT NULL DEFAULT '', moderated_by INTEGER REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(NOT share_file OR file_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS portfolio_public_owner ON portfolio_entries(owner_id,visibility,moderation_status);
CREATE TABLE IF NOT EXISTS reviews (
 id SERIAL PRIMARY KEY, booking_id INTEGER REFERENCES bookings(id), exchange_id INTEGER REFERENCES exchanges(id),
 author_id INTEGER NOT NULL REFERENCES users(id), subject_id INTEGER NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL,
 moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK(moderation_status IN ('visible','hidden')),
 moderation_reason TEXT NOT NULL DEFAULT '', moderated_by INTEGER REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(booking_id,exchange_id)=1), CHECK(author_id<>subject_id), UNIQUE(booking_id,author_id), UNIQUE(exchange_id,author_id)
);
CREATE INDEX IF NOT EXISTS reviews_public_subject ON reviews(subject_id,moderation_status);
CREATE TABLE IF NOT EXISTS project_demo_fixtures (
 marker TEXT PRIMARY KEY, task_id INTEGER UNIQUE NOT NULL REFERENCES project_tasks(id)
);
