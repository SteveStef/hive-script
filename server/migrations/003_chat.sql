-- Phase 6: world chat. Every player in a world sees its messages.
CREATE TABLE chat (
  id bigserial PRIMARY KEY,
  world_id int NOT NULL REFERENCES worlds ON DELETE CASCADE,
  user_id int NOT NULL REFERENCES users ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_world ON chat (world_id, id);
