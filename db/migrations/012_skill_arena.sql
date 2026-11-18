CREATE TABLE IF NOT EXISTS arena_materials (
 id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('coding','design','english')),
 difficulty TEXT NOT NULL DEFAULT 'Beginner', storage_key TEXT NOT NULL,
 original_name TEXT NOT NULL, questions JSONB NOT NULL DEFAULT '[]',
 published BOOLEAN NOT NULL DEFAULT FALSE, question_source TEXT NOT NULL DEFAULT 'admin',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arena_rooms (
 id UUID PRIMARY KEY, code TEXT UNIQUE NOT NULL, host_id INTEGER NOT NULL REFERENCES users(id),
 game TEXT NOT NULL CHECK(game IN ('detective','relay','typing')),
 mode TEXT NOT NULL CHECK(mode IN ('solo','bot','friends')),
 status TEXT NOT NULL DEFAULT 'lobby', state JSONB NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arena_members (
 room_id UUID NOT NULL REFERENCES arena_rooms(id), user_id INTEGER NOT NULL REFERENCES users(id),
 joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS arena_rooms_host ON arena_rooms(host_id,created_at DESC);
CREATE TABLE IF NOT EXISTS arena_certificates (
 id UUID PRIMARY KEY, room_id UUID UNIQUE NOT NULL REFERENCES arena_rooms(id),
 user_id INTEGER NOT NULL REFERENCES users(id), winner_name TEXT NOT NULL,
 game TEXT NOT NULL, score NUMERIC NOT NULL, issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
