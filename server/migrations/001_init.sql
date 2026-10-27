-- Accounts, saved scripts, and one server-run colony per player (phases 1 and 2).

CREATE TABLE users (
  id serial PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

CREATE TABLE sessions (
  token text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- What the editor holds: single player's scripts, and multiplayer's drafts. position orders roles.
CREATE TABLE scripts (
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('single', 'multi')),
  file text NOT NULL,
  code text NOT NULL,
  position int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mode, file)
);

-- What actually runs: every deploy, newest last (kept for a future undo).
CREATE TABLE deploys (
  id bigserial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  files jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE colonies (
  user_id int PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  seed int NOT NULL,
  state jsonb NOT NULL,
  tick int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The colony's notes, deaths, errors and seasons, for "while you were away".
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  tick int NOT NULL,
  tone text,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_user_time ON events (user_id, created_at);
