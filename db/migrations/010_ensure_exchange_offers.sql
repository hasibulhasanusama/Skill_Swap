
CREATE TABLE IF NOT EXISTS exchange_offers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  skills JSONB NOT NULL,
  availability JSONB NOT NULL,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
